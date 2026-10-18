"""Native Android smoke test. Synthetic local API only; never production."""
import subprocess, time, re, pathlib, json, urllib.request, threading, xml.etree.ElementTree as ET
out = pathlib.Path('tmp/android-launch')
out.mkdir(parents=True, exist_ok=True)
def adb(*args):
    return subprocess.check_output(['adb', *args], stderr=subprocess.STDOUT, timeout=45)
def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/window.xml'))
def find(label, timeout=40):
    until=time.time()+timeout
    launcher_recoveries=0
    while time.time()<until:
        try:
            root=tree()
        except (ET.ParseError, subprocess.CalledProcessError):
            time.sleep(2)
            continue
        if label == 'Bienvenue' and launcher_recoveries < 2 and any(n.get('text') == "Pixel Launcher isn't responding" for n in root.iter('node')):
            # Recover only the emulator's launcher, never dismiss a JJD crash.
            tap_node(next(n for n in root.iter('node') if n.get('text') == 'Close app'))
            adb('shell','am','start','-n','be.jjdconsult.chantier/.MainActivity')
            launcher_recoveries += 1
            continue
        for n in root.iter('node'):
            if label.casefold() in (n.get('text','')+' '+n.get('content-desc','')).casefold():
                return n
        time.sleep(1)
    raise AssertionError('Missing native UI: '+label)
def tap_node(n):
    a=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
    assert len(a)==4
    adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2))
def tap(label):
    tap_node(find(label))
def shot(name):
    root=tree()
    time.sleep(1)
    (out/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))
    ET.ElementTree(root).write(out/(name+'.xml'), encoding='utf-8')
def fill(index, value):
    nodes=[n for n in tree().iter('node') if n.get('class')=='android.widget.EditText']
    assert len(nodes)>index, 'Missing login input'
    tap_node(nodes[index])
    adb('shell','input','keyevent','KEYCODE_MOVE_END')
    for _ in range(30): adb('shell','input','keyevent','KEYCODE_DEL')
    adb('shell','input','text',value)
    adb('shell','input','keyevent','4')

def timer_started():
    until=time.time()+60
    while time.time()<until:
        root=tree()
        labels=[n.get('text','') for n in root.iter('node')]
        if any(label in labels for label in ['Position non transmise', 'Pointage hors zone', 'Point de référence enregistré']):
            shot('location-unavailable-warning')
            tap('OK')  # Unavailable GPS is explicitly reported, never a silent failure.
        elif any(label.casefold() == 'compteur en cours' for label in labels):
            return
        time.sleep(1)
    raise AssertionError('Timer did not start')

def gps_stream():
    # Android's test providers also serve balanced/coarse location requests.
    while True:
        try:
            for provider in ['gps', 'network']:
                adb('shell','cmd','location','providers','set-test-provider-location',provider,'--location','50.8467,4.3525','--accuracy','5')
        except Exception: return
        time.sleep(2)
try:
    apk=next(pathlib.Path('apps/mobile/android/app/build/outputs/apk/release').glob('*.apk'))
    adb('reverse','tcp:4100','tcp:4100')
    adb('install','-r',str(apk))
    adb('shell','pm','grant','be.jjdconsult.chantier','android.permission.ACCESS_FINE_LOCATION')
    adb('shell','pm','grant','be.jjdconsult.chantier','android.permission.ACCESS_COARSE_LOCATION')
    adb('shell','settings','put','secure','location_mode','3')
    adb('emu','geo','fix','4.3525','50.8467')
    adb('logcat','-c')
    adb('shell','am','start','-n','be.jjdconsult.chantier/.MainActivity')
    find('Bienvenue',120)
    shot('01-login')
    fill(0,'ouvrier@jjd-consult.be')
    fill(1,'incorrect')
    tap('Se connecter')
    find('incorrect')
    fill(1,'jjd')
    tap('Se connecter')
    find('Mes heures',60)
    shot('02-worker-home')
    # Visual checks for enlarged system text and short landscape screens.
    adb('shell','settings','put','system','font_scale','1.5')
    time.sleep(2)
    shot('02-large-text')
    adb('shell','settings','put','system','font_scale','1.0')
    adb('shell','settings','put','system','accelerometer_rotation','0')
    adb('shell','settings','put','system','user_rotation','1')
    time.sleep(2)
    shot('02-landscape')
    adb('shell','settings','put','system','user_rotation','0')
    time.sleep(2)
    heading=find('Bonjour')
    assert int(re.findall(r'\d+',heading.get('bounds'))[1]) >= 60, 'Header overlaps system status bar'
    adb('shell','appops','set','2000','android:mock_location','allow')
    for provider in ['gps', 'network']:
        adb('shell','cmd','location','providers','add-test-provider',provider)
        adb('shell','cmd','location','providers','set-test-provider-enabled',provider,'true')
    threading.Thread(target=gps_stream,daemon=True).start()
    tap('Je suis arrivé')
    timer_started()
    shot('02b-timer-running')
    tap('Je quitte le chantier')
    find('Rester')
    confirm=next(n for n in tree().iter('node') if n.get('text','').casefold()=='je quitte')
    tap_node(confirm)
    find('Bonne fin de journée',60)
    shot('02c-timer-stopped')
    tap('Passer')
    # Inspect the persisted result on the isolated API, not only screen text.
    request=urllib.request.Request('http://127.0.0.1:4100/api/auth/login',data=json.dumps({'email':'ouvrier@jjd-consult.be','password':'jjd'}).encode(),headers={'Content-Type':'application/json'})
    token=json.load(urllib.request.urlopen(request))['token']
    request=urllib.request.Request('http://127.0.0.1:4100/api/timesheet/mine',headers={'Authorization':'Bearer '+token})
    entries=json.load(urllib.request.urlopen(request))['items']
    assert len(entries)==1, entries
    entry=entries[0]
    assert entry['status']=='submitted' and entry['endedAt'] and entry['startRequestId'] and entry['stopRequestId'], entry
    (out/'pointage.json').write_text(json.dumps(entry,indent=2))
    # Disconnect the app from its API, record a complete second visit, then
    # kill/restart the process before reconnecting. No production traffic.
    adb('reverse','--remove','tcp:4100')
    tap('Je suis arrivé')
    timer_started()
    shot('02d-offline-running')
    tap('Je quitte le chantier')
    find('Rester')
    tap_node(next(n for n in tree().iter('node') if n.get('text','').casefold()=='je quitte'))
    find('Bonne fin de journée',60)
    tap('Passer')
    adb('shell','am','force-stop','be.jjdconsult.chantier')
    adb('shell','am','start','-n','be.jjdconsult.chantier/.MainActivity')
    find('synchroniser',90)
    shot('02e-offline-restarted')
    adb('reverse','tcp:4100','tcp:4100')
    tap('Mes heures')
    tap('Aujourd’hui')
    find('Je suis arrivé',60)
    for _ in range(30):
        entries=json.load(urllib.request.urlopen(request))['items']
        if len(entries)==2 and all(e['status']=='submitted' for e in entries): break
        time.sleep(1)
    assert len(entries)==2 and all(e['status']=='submitted' for e in entries), entries
    assert all(e['startRequestId'] and e['stopRequestId'] for e in entries), entries
    assert any(e['startLat'] is not None and abs(e['startLat']-50.8467)<0.01 for e in entries), 'No simulated GPS fix reached the API'
    (out/'pointage-after-offline.json').write_text(json.dumps(entries,indent=2))
    shot('02f-offline-synced')
    tap('Mes heures')
    shot('03-hours')
    tap('Chantiers')
    shot('04-worksites')
    tap('Messages')
    shot('05-messages')
    tap('Plus')
    find('Mon compte')
    shot('06-more')
    tap('Mon compte')
    find('Déconnexion')
    shot('07-account')
    tap('Déconnexion')
    find('Bienvenue')
    shot('08-logout')
    print('ANDROID_NATIVE_SMOKE_OK: login, GPS pointage, offline start/stop, offline restart, replay without duplicates, hours, worksites, messages, profile, logout')
finally:
    try: shot('final')
    except Exception: pass
    (out/'logcat.txt').write_bytes(adb('logcat','-d'))
