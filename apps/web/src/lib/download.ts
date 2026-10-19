/** Preserve the server filename when saving an authenticated response. */
export function downloadFilename(disposition: string | null, fallback = 'document.pdf'): string {
  let name = '';
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try { name = decodeURIComponent(encoded[1]!.trim()); } catch { /* use plain filename */ }
  }
  if (!name) name = disposition?.match(/filename="([^"]+)"/i)?.[1]
    ?? disposition?.match(/filename=([^;]+)/i)?.[1]?.trim() ?? fallback;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || fallback;
}

export async function downloadResponse(response: Response, fallback = 'document.pdf'): Promise<void> {
  const filename = downloadFilename(response.headers.get('content-disposition'), fallback);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    // Give the browser time to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
