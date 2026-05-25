// Uint32-packed bitset. Single building block for all node/edge masks in the
// cross-panel filter propagation. Backed by Uint32Array(ceil(N/32)); each bit
// position `i` lives at word `i >>> 5`, bit `i & 31`.
//
// Operations on N=17412 bits (MC1 full graph):
//   set/get/clear         ~10 ns
//   andInPlace/orInPlace  ~3 µs  (545 words)
//   popcount              ~5 µs  (Kernighan)
//   iterate set bits      ~50 µs (sparse) — uses `31 - Math.clz32(lsb)` for
//                                exact bit index (Math.log2 loses precision).

export class Bitset {
  constructor(n) {
    this.n = n
    this.words = new Uint32Array(Math.ceil(n / 32))
  }

  set(i)    { this.words[i >>> 5] |=  (1 << (i & 31)) }
  clear(i)  { this.words[i >>> 5] &= ~(1 << (i & 31)) }
  get(i)    { return (this.words[i >>> 5] & (1 << (i & 31))) !== 0 }

  setAll() {
    this.words.fill(0xFFFFFFFF)
    this._maskTail()
  }

  clearAll() { this.words.fill(0) }

  andInPlace(o) {
    const w = this.words, ow = o.words
    for (let k = 0; k < w.length; k++) w[k] &= ow[k]
  }

  orInPlace(o) {
    const w = this.words, ow = o.words
    for (let k = 0; k < w.length; k++) w[k] |= ow[k]
  }

  clone() {
    const b = new Bitset(this.n)
    b.words.set(this.words)
    return b
  }

  // Kernighan's bit-count: w &= w-1 clears the lowest set bit each iteration.
  popcount() {
    let count = 0
    const w = this.words
    for (let k = 0; k < w.length; k++) {
      let x = w[k]
      while (x) { count++; x &= x - 1 }
    }
    return count
  }

  *[Symbol.iterator]() {
    const w = this.words
    for (let k = 0; k < w.length; k++) {
      let x = w[k]
      const base = k << 5
      while (x) {
        const lsb = x & -x
        yield base + (31 - Math.clz32(lsb))
        x ^= lsb
      }
    }
  }

  _maskTail() {
    const extra = this.words.length * 32 - this.n
    if (extra > 0) this.words[this.words.length - 1] &= (0xFFFFFFFF >>> extra)
  }
}
