export function compress(data) {
  const runs = [];
  let i = 0;
  while (i < data.length) {
    let runLen = 1;
    while (i + runLen < data.length && data[i + runLen] === data[i] && runLen < 255) {
      runLen++;
    }
    runs.push(runLen, data[i]);
    i += runLen;
  }

  if (runs.length >= data.length) return null;

  const dict = new Uint8Array(0);
  const out = new Uint8Array(runs.length);
  for (let j = 0; j < runs.length; j++) out[j] = runs[j];
  return { data: out, dict };
}

export function decompress(data, dict) {
  const out = [];
  for (let i = 0; i < data.length; i += 2) {
    const count = data[i];
    const value = data[i + 1];
    for (let j = 0; j < count; j++) out.push(value);
  }
  return new Uint8Array(out);
}