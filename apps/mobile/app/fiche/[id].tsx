import { useCallback, useState } from 'react';
import { ScrollView, Text, View, Pressable, Linking, TextInput } from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Label, Loading, Row, Muted, dateBE } from '@/lib/ui';
import { T } from '@/lib/theme';

interface Task { id: string; title: string; status: string; assignees: { id: string; name: string }[] }

const ROLE: Record<string, string> = {
  concierge: 'Concierge', president: 'Président', council: 'Conseil', syndic_manager: 'Gestionnaire syndic',
  contact: 'Contact', owner_rep: 'Représentant copro', other: 'Autre',
};

interface Field {
  worksite: { id: string; ref: string; title: string; description: string | null; address: string };
  building: { name: string; digicode: string | null; accessNote: string | null; contacts: { role: string; name: string; phone: string | null }[] } | null;
  client: { name: string; phone: string | null } | null;
  manager: { name: string; phone: string | null } | null;
  owner: { name: string; phone: string | null; email: string | null } | null;
  tenant: { name: string; phone: string | null; phone2: string | null; email: string | null } | null;
  today: {
    startAt: string; endAt: string; allDay: boolean; toDo: string | null; materials: string | null;
    team: string | null; vehicle: string | null; people: { userId: string | null; name: string; phone: string | null }[];
    equipment: { name: string; reference: string | null }[];
    consumables: { name: string; qty: number; unit: string }[];
  } | null;
}

function Phone({ label, name, phone }: { label: string; name: string; phone: string | null }) {
  return (
    <Pressable onPress={() => phone && Linking.openURL(`tel:${phone.replace(/\s/g, '')}`)} style={{ paddingVertical: 6 }}>
      <Text style={{ color: T.ink }}>
        <Text style={{ color: T.ink2 }}>{label} · </Text>
        {name}{phone ? <Text style={{ color: T.primary, fontWeight: '700' }}>  {phone}</Text> : null}
      </Text>
    </Pressable>
  );
}

export default function FicheDuJour() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Field | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignees, setNewTaskAssignees] = useState<Set<string>>(new Set());
  const [addingTask, setAddingTask] = useState(false);
  const load = useCallback(() => {
    apiGet<Field>(`/api/worksites/${id}/field`).then(setD).catch(() => {});
    apiGet<{ items: Task[] }>(`/api/worksites/${id}/tasks`).then((r) => setTasks(r.items)).catch(() => {});
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!d) return <Loading />;
  const w = d.worksite;

  const toggleTask = async (t: Task) => {
    const next = t.status === 'done' ? 'todo' : 'done';
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    await apiSend(`/api/tasks/${t.id}`, 'PATCH', { status: next });
  };
  const toggleNewTaskAssignee = (userId: string) => {
    setNewTaskAssignees((s) => {
      const next = new Set(s);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };
  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    setAddingTask(true);
    try {
      const r = await apiSend<{ task: Task }>(`/api/worksites/${id}/tasks`, 'POST', {
        title: newTaskTitle.trim(),
        assigneeIds: [...newTaskAssignees],
      });
      if ('task' in r) setTasks((ts) => [...ts, r.task]);
      setNewTaskTitle('');
      setNewTaskAssignees(new Set());
    } finally {
      setAddingTask(false);
    }
  };
  const assignableToday = (d.today?.people ?? []).filter((p): p is typeof p & { userId: string } => !!p.userId);
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: w.ref, headerBackTitle: 'Retour' }} />

      <Card>
        <Text style={{ fontSize: 16, fontWeight: '700', color: T.ink }}>{w.title}</Text>
        {w.address ? (
          <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}`)} style={{ marginTop: 4 }}>
            <Text style={{ color: T.primary, fontWeight: '600' }}>📍 {w.address}  ›  Itinéraire</Text>
          </Pressable>
        ) : null}
        {d.building?.digicode ? <Row k="Digicode" v={d.building.digicode} /> : null}
      </Card>

      {d.building?.accessNote ? <Card><Label>Accès</Label><Text style={{ color: T.ink }}>{d.building.accessNote}</Text></Card> : null}

      <Card>
        <Label>À faire{d.today && !d.today.allDay ? ` · ${new Date(d.today.startAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}–${new Date(d.today.endAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` : ''}</Label>
        <Text style={{ color: T.ink }}>{d.today?.toDo || w.description || 'Voir avec le bureau.'}</Text>
        {d.today?.materials ? <Text style={{ color: T.ink2, marginTop: 6 }}>🧰 {d.today.materials}</Text> : null}
        {d.today?.vehicle ? <Text style={{ color: T.ink2, marginTop: 2 }}>🚐 {d.today.vehicle}</Text> : null}
      </Card>

      {d.today && (d.today.equipment.length > 0 || d.today.consumables.length > 0) ? (
        <Card>
          <Label>Matériel &amp; consommables</Label>
          {d.today.equipment.map((e, i) => (
            <Text key={`e${i}`} style={{ color: T.ink, paddingVertical: 3 }}>
              🧰 {e.name}{e.reference ? ` (${e.reference})` : ''}
            </Text>
          ))}
          {d.today.consumables.map((c, i) => (
            <Text key={`c${i}`} style={{ color: T.ink, paddingVertical: 3 }}>
              📦 {c.qty} {c.unit} — {c.name}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card>
        <Label>Tâches ({openTasks.length} à faire)</Label>
        {[...openTasks, ...doneTasks].map((t) => (
          <Pressable key={t.id} onPress={() => toggleTask(t)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
            <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: t.status === 'done' ? T.ok : T.line, backgroundColor: t.status === 'done' ? T.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {t.status === 'done' && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
            </View>
            <Text style={{ flex: 1, color: t.status === 'done' ? T.ink3 : T.ink, textDecorationLine: t.status === 'done' ? 'line-through' : 'none' }}>
              {t.title}{t.assignees.length ? `  ·  ${t.assignees.map((a) => a.name).join(', ')}` : ''}
            </Text>
          </Pressable>
        ))}

        <View style={{ marginTop: 8, gap: 8 }}>
          <TextInput
            value={newTaskTitle}
            onChangeText={setNewTaskTitle}
            placeholder="+ Nouvelle tâche…"
            placeholderTextColor={T.ink3}
            style={{ borderWidth: 1, borderColor: T.line, borderRadius: 8, padding: 10, fontSize: 15, color: T.ink }}
          />
          {assignableToday.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {assignableToday.map((p) => {
                const on = newTaskAssignees.has(p.userId);
                return (
                  <Pressable
                    key={p.userId}
                    onPress={() => toggleNewTaskAssignee(p.userId)}
                    style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primary : 'transparent' }}
                  >
                    <Text style={{ color: on ? '#fff' : T.ink2, fontSize: 13 }}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Pressable
            disabled={!newTaskTitle.trim() || addingTask}
            onPress={addTask}
            style={{ alignSelf: 'flex-start', backgroundColor: newTaskTitle.trim() ? T.primary : T.surface2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}
          >
            <Text style={{ color: newTaskTitle.trim() ? '#fff' : T.ink3, fontWeight: '700' }}>{addingTask ? 'Ajout…' : 'Ajouter'}</Text>
          </Pressable>
        </View>
      </Card>

      {d.today && d.today.people.length > 0 ? (
        <Card>
          <Label>Équipe du jour</Label>
          {d.today.people.map((p, i) => <Phone key={i} label="Ouvrier" name={p.name} phone={p.phone} />)}
        </Card>
      ) : null}

      <Card>
        <Label>Contacts</Label>
        {d.manager ? <Phone label="Chef de chantier" name={d.manager.name} phone={d.manager.phone} /> : null}
        {d.client ? <Phone label="Client" name={d.client.name} phone={d.client.phone} /> : null}
        {d.owner ? <Phone label="Propriétaire" name={d.owner.name} phone={d.owner.phone} /> : null}
        {d.tenant ? <Phone label="Locataire" name={d.tenant.name} phone={d.tenant.phone} /> : null}
        {d.tenant?.phone2 ? <Phone label="Locataire (2)" name={d.tenant.name} phone={d.tenant.phone2} /> : null}
        {(d.building?.contacts ?? []).map((c, i) => <Phone key={i} label={ROLE[c.role] ?? c.role} name={c.name} phone={c.phone} />)}
        {!d.manager && !d.client && !d.owner && !d.tenant && !(d.building?.contacts ?? []).length ? <Muted>Aucun contact renseigné.</Muted> : null}
      </Card>

      <View style={{ gap: 8, marginTop: 4 }}>
        <Pressable style={{ backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 13, alignItems: 'center' }} onPress={() => router.push(`/fil/${id}` as never)}>
          <Text style={{ color: T.ink, fontWeight: '700' }}>💬 Fil de chantier</Text>
        </Pressable>
        <Pressable style={{ backgroundColor: T.primary, borderRadius: 10, padding: 14, alignItems: 'center' }} onPress={() => router.push(`/rapport/${id}` as never)}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Faire le rapport de chantier</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
