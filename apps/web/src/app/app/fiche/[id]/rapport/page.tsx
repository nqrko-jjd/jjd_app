'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, apiUpload } from '@/lib/api';
import { PageHead } from '@/lib/ui';
import { SignaturePad } from '@/components/SignaturePad';

interface Report {
  id: string; status: string; workDone: string | null; notes: string | null; clientName: string | null;
  photos: { id: string; url: string; thumbUrl: string | null }[];
}

export default function RapportChantierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: worksiteId } = use(params);
  const [report, setReport] = useState<Report | null>(null);
  const [workDone, setWorkDone] = useState('');
  const [notes, setNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'sign' | 'done'>('edit');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api<{ items: Report[] }>(`/api/worksites/${worksiteId}/reports`);
        const draft = list.items.find((r) => r.status === 'draft');
        if (draft) {
          setReport(draft);
          setWorkDone(draft.workDone ?? '');
          setNotes(draft.notes ?? '');
        } else {
          const { report: r } = await api<{ report: Report }>(`/api/worksites/${worksiteId}/reports`, { method: 'POST', body: {} });
          setReport(r);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [worksiteId]);

  const save = useCallback(async (patch: { workDone?: string; notes?: string }) => {
    if (!report) return;
    await api(`/api/reports/${report.id}`, { method: 'PATCH', body: patch });
  }, [report]);

  async function addPhoto(files: FileList | null) {
    if (!report || !files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        await apiUpload(`/api/reports/${report.id}/photos`, fd);
      }
      const { report: fresh } = await api<{ report: Report }>(`/api/reports/${report.id}`);
      setReport(fresh);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onSignature(dataUrl: string) {
    if (!report || !clientName.trim()) { setErr('Indique le nom de la personne qui signe.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await save({ workDone, notes });
      await api(`/api/reports/${report.id}/sign`, { method: 'POST', body: { clientName: clientName.trim(), signature: dataUrl } });
      setMode('done');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !report) return <div className="empty">{err}</div>;
  if (!report) return <div className="empty">Chargement…</div>;

  if (mode === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div style={{ fontSize: '2.8rem' }}>✅</div>
        <h1 style={{ margin: '0.6rem 0 0.3rem' }}>Rapport signé par {report.clientName || clientName}</h1>
        <p className="muted">Le bureau et le client y ont accès.</p>
        <Link href={`/app/fiche/${worksiteId}`} className="btn primary" style={{ marginTop: '1rem', display: 'inline-block' }}>Terminer</Link>
      </div>
    );
  }

  if (mode === 'sign') {
    return (
      <>
        <PageHead title="Signature du client" />
        <div className="field" style={{ marginBottom: '0.8rem', maxWidth: 360 }}>
          <label>Nom de la personne qui signe</label>
          <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="ex. M. Dupont" />
        </div>
        <p className="muted" style={{ marginBottom: '0.6rem' }}>Fais signer le client au doigt (ou à la souris) dans le cadre ci-dessous.</p>
        <SignaturePad onDone={onSignature} onEmpty={() => setErr('La signature est vide.')} />
        {err && <p style={{ color: 'var(--crit)', marginTop: '0.6rem' }}>{err}</p>}
        {busy && <p className="muted" style={{ marginTop: '0.6rem' }}>Envoi…</p>}
        <button type="button" className="btn ghost" style={{ marginTop: '1rem' }} onClick={() => { setErr(null); setMode('edit'); }}>← Retour</button>
      </>
    );
  }

  return (
    <>
      <PageHead title="Rapport de chantier" sub={`${report.photos.length} photo${report.photos.length > 1 ? 's' : ''}`} />

      <div className="field" style={{ marginBottom: '0.9rem' }}>
        <label>Travaux réalisés</label>
        <textarea
          className="input" rows={5}
          value={workDone}
          onChange={(e) => setWorkDone(e.target.value)}
          onBlur={() => save({ workDone })}
          placeholder="Ce qui a été fait aujourd'hui…"
        />
      </div>

      <div className="field" style={{ marginBottom: '0.9rem' }}>
        <label>Remarques / réserves (optionnel)</label>
        <textarea
          className="input" rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save({ notes })}
          placeholder="Points à signaler, matériel manquant…"
        />
      </div>

      <div className="card card-pad" style={{ marginBottom: '1.2rem' }}>
        <div className="muted" style={{ marginBottom: '0.4rem' }}>Photos ({report.photos.length})</div>
        {report.photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '0.7rem' }}>
            {report.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.thumbUrl ?? p.url} alt="" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhoto(e.target.files)} />
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Envoi…' : '📷 Ajouter une photo'}
        </button>
      </div>

      {err && <p style={{ color: 'var(--crit)', marginBottom: '0.8rem' }}>{err}</p>}

      <button
        type="button" className="btn primary" style={{ width: '100%', padding: '0.8rem', fontSize: '0.95rem' }}
        onClick={async () => { await save({ workDone, notes }); setErr(null); setMode('sign'); }}
      >
        Faire signer le client
      </button>
      <p className="muted" style={{ textAlign: 'center', marginTop: '0.6rem' }}>Le rapport est enregistré automatiquement.</p>
    </>
  );
}
