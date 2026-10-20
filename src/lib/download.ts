// 파일 저장: claude.ai 아티팩트에서는 downloads 기능, 일반 웹에서는 브라우저 다운로드
export async function saveFile(filename: string, data: Blob): Promise<'saved' | 'declined' | 'error'> {
  const safe = filename.replace(/[\\/:*?"<>|]/g, '_');
  try {
    if (window.claude?.use) {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try {
          await dl.save({ filename: safe, data });
          return 'saved';
        } catch (e: any) {
          if (e?.code === 'declined') return 'declined';
          if (e?.code !== 'unavailable' && e?.code !== 'not_granted') return 'error';
        }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch {
    return 'error';
  }
}
