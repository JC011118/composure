/**
 * Minimal decoder for the SDK's `presage.smartspectra.Insight` protobuf,
 * which the Node SDK delivers on its 'insight' event but does not ship a
 * decoder for. Schema (docs/data-types.md, "Insight"):
 *
 *   message Insight {
 *     int32 request_id = 1;
 *     string processed_at = 2;
 *     oneof result { string analysis = 3; string error = 4; }
 *     InsightType type = 5;
 *   }
 *
 * Unknown fields are skipped, so a newer SDK adding fields does not break us.
 */

export interface DecodedInsight {
  requestId: number | null;
  processedAt: string;
  analysis: string | null;
  error: string | null;
  type: number;
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) throw new Error('truncated varint');
      const b = this.buf[this.pos++];
      if (shift < 32) result |= (b & 0x7f) << shift;
      else result += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if ((b & 0x80) === 0) return result;
    }
    throw new Error('varint too long');
  }

  bytes(): Uint8Array {
    const len = this.varint();
    if (len < 0 || this.pos + len > this.buf.length) throw new Error('truncated length-delimited field');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.varint();
        return;
      case 1:
        this.pos += 8;
        return;
      case 2:
        this.bytes();
        return;
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`unsupported wire type ${wireType}`);
    }
  }
}

const utf8 = new TextDecoder('utf-8');

export function decodeInsight(buf: Uint8Array | ArrayBuffer): DecodedInsight {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const r = new Reader(bytes);
  const out: DecodedInsight = { requestId: null, processedAt: '', analysis: null, error: null, type: 0 };
  while (!r.done) {
    const key = r.varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (field === 1 && wire === 0) out.requestId = r.varint() | 0;
    else if (field === 2 && wire === 2) out.processedAt = utf8.decode(r.bytes());
    else if (field === 3 && wire === 2) {
      out.analysis = utf8.decode(r.bytes());
      out.error = null;
    } else if (field === 4 && wire === 2) {
      out.error = utf8.decode(r.bytes());
      out.analysis = null;
    } else if (field === 5 && wire === 0) out.type = r.varint();
    else r.skip(wire);
  }
  return out;
}

/** Test helper: encode an Insight (same schema). */
export function encodeInsight(i: Partial<DecodedInsight>): Uint8Array {
  const parts: number[] = [];
  const varint = (n: number) => {
    let v = n >>> 0;
    while (v > 0x7f) {
      parts.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    parts.push(v);
  };
  const str = (field: number, s: string) => {
    const b = new TextEncoder().encode(s);
    varint((field << 3) | 2);
    varint(b.length);
    parts.push(...b);
  };
  if (i.requestId !== null && i.requestId !== undefined) {
    varint(1 << 3);
    varint(i.requestId);
  }
  if (i.processedAt) str(2, i.processedAt);
  if (i.analysis) str(3, i.analysis);
  if (i.error) str(4, i.error);
  if (i.type) {
    varint(5 << 3);
    varint(i.type);
  }
  return new Uint8Array(parts);
}
