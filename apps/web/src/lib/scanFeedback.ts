/** Retour sonore + vibration à chaque scan (bip aigu = ok, grave = refusé) — utile quand on a les yeux sur la marchandise. */
export function scanFeedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 40 : [80, 60, 80]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = ok ? 1500 : 320;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.28));
    osc.onended = () => ctx.close();
  } catch {
    /* pas de son : sans importance */
  }
}
