// Family doodles made with Google's Gemini image model. Only the photo you choose is sent to Google;
// no financial data ever is. The finished pictures are stored in your encrypted vault.

export const MOODS = [
  ['cheer', 'Overview: spent more than you saved', 'cheering encouragingly with fists raised, determined and hopeful smiles, as if saying "we have got this"'],
  ['smile1', 'Overview: saved up to €500 a month', 'standing together with gentle, light smiles'],
  ['smile2', 'Overview: saved €500–1,000 a month', 'smiling broadly and happily, one of them giving a thumbs-up'],
  ['celebrate', 'Overview: saved over €1,000 a month', 'celebrating joyfully with arms up and laughing, a little confetti around them'],
  ['together', 'Months', 'standing close together, arm in arm, warm, supportive and reassuring'],
  ['thinking', 'Review', 'thinking together: one with a hand on the chin, a small lightbulb above them, curious and thoughtful'],
  ['question', 'Data', 'looking curious and asking something: heads slightly tilted, one shrugging, a small question mark above them'],
];
const STYLE = 'a warm, hand-drawn doodle illustration: clean dark ink outlines, a few soft flat colours, simple friendly faces that still clearly resemble each person (hair, face shape, glasses, skin tone, clothing). Plain pure white background, everyone fully visible, no text, no frame, no border.';

// Shrink a picture on this device before it goes anywhere (also strips photo metadata such as location).
export function shrink(src, max, type = 'image/jpeg', quality = 0.86) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL(type, quality));
    };
    img.onerror = () => rej(new Error('That picture could not be read. Try a JPEG or PNG photo.'));
    img.src = src;
  });
}
const part = (dataUrl) => { const [h, d] = dataUrl.split(','); return { inline_data: { mime_type: h.slice(5, h.indexOf(';')), data: d } }; };

async function draw(key, model, images, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [...images.map(part), { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error && j.error.message ? `Gemini: ${j.error.message}` : `Gemini answered with error ${r.status}.`);
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) throw new Error('Gemini did not return a picture this time (it sometimes declines photos). Try again or use another photo.');
  const d = img.inlineData || img.inline_data;
  return shrink(`data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`, 512);
}

// photo -> one base doodle -> every mood drawn from that base, so faces stay consistent.
export async function makeSet({ key, model, photo, onStep }) {
  onStep(0, MOODS.length + 1);
  const base = await draw(key, model, [photo], `Turn this photo into ${STYLE}`);
  const out = { base };
  let done = 1; onStep(done, MOODS.length + 1);
  const queue = [...MOODS];
  const worker = async () => {
    while (queue.length) {
      const [id, , pose] = queue.shift();
      out[id] = await draw(key, model, [base, photo], `Using exactly the same doodle characters, drawing style and colours as the first image (the second image is the real photo, for likeness), draw them ${pose}. ${STYLE}`);
      onStep(++done, MOODS.length + 1);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
export async function redoOne({ key, model, photo, base, id }) {
  const pose = MOODS.find((m) => m[0] === id)[2];
  return draw(key, model, [base, photo], `Using exactly the same doodle characters, drawing style and colours as the first image (the second image is the real photo, for likeness), draw them ${pose}. ${STYLE}`);
}
