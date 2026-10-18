"""Native Android smoke test. Synthetic local API only; never production."""
import subprocess, time, re, pathlib, xml.etree.ElementTree as ET
out = pathlib.Path('tmp/android-launch')
out.mkdir(parents=True, exist_ok=True)
def adb(*args):
    return subprocess.check_output(['adb', *args], stderr=subprocess.STDOUT, timeout=45)
def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/window.xml'))
def find(label, timeout=40):
    until=time.time()+timeout
    while time.time()<until:
        try:
            root=tree()
        except (ET.ParseError, subprocess.CalledProcessError):
            time.sleep(2)
            continue
        for n in root.iter('node'):
            if label in (n.get('text','')+' '+n.get('content-desc','')):
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
try:
    apk=next(pathlib.Path('apps/mobile/android/app/build/outputs/apk/release').glob('*.apk'))
    adb('reverse','tcp:4100','tcp:4100')
    adb('install','-r',str(apk))
    adb('logcat','-c')
    adb('shell','am','start','-n','be.jjdconsult.chantier/.MainActivity')
    find('Bienvenue',90)
    shot('01-login')
    fill(0,'ouvrier@jjd-consult.be')
    fill(1,'incorrect')
    tap('Se connecter')
    find('incorrect')
    fill(1,'jjd')
    tap('Se connecter')
    find('Mes heures',60)
    shot('02-worker-home')
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
    print('ANDROID_NATIVE_SMOKE_OK: launch, invalid login, worker login, hours, worksites, messages, profile, logout')
finally:
    try: shot('final')
    except Exception: pass
    (out/'logcat.txt').write_bytes(adb('logcat','-d'))
