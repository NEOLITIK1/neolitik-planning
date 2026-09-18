// JSONB may reorder object keys. Compare content, not key insertion order.
export function stableSerialize(value) {
  if(Array.isArray(value))return `[${value.map(stableSerialize).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
