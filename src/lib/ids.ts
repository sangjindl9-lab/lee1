import crypto from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function code(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export const newOrderNo = () => `DV-${stamp()}-${code(6)}`;
export const newDisputeNo = () => `DP-${stamp()}-${code(5)}`;
export const newRequestNo = () => `RQ-${stamp()}-${code(5)}`;
export const newContractNo = () => `CT-${stamp()}-${code(5)}`;
export const newPayoutNo = () => `PY-${stamp()}-${code(6)}`;
