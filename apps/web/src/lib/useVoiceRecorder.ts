import { useRef, useState } from 'react';

/** Enregistre une note vocale depuis le micro du navigateur (MediaRecorder) et appelle
 *  `onDone` avec le blob audio une fois l'enregistrement arrêté — à envoyer tel quel en
 *  multipart, le format (webm/ogg selon le navigateur) n'a pas besoin d'être connu à l'avance. */
export function useVoiceRecorder(onDone: (blob: Blob) => void | Promise<void>) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size > 0) onDone(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert('Impossible d’accéder au micro — vérifie les autorisations du navigateur.');
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return { recording, start, stop };
}
