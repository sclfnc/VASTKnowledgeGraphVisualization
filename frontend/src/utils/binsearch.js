// Binary search on numeric arrays (works on plain Array, Int32Array, Float64Array, …).
//
// Standard semantics:
//   asc:  lowerBound = smallest i with arr[i] >= target
//         upperBound = smallest i with arr[i] >  target
//   desc: lowerBound = smallest i with arr[i] <= target
//         upperBound = smallest i with arr[i] <  target
//
// Both return arr.length when no such index exists. Range of values matching
// `lo <= arr[i] <= hi` on a desc array: [lowerBound(arr, hi, true), upperBound(arr, lo, true)).

export function lowerBound(arr, target, desc = false) {
  let lo = 0, hi = arr.length
  if (desc) {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid] > target) lo = mid + 1
      else hi = mid
    }
  } else {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid] < target) lo = mid + 1
      else hi = mid
    }
  }
  return lo
}

export function upperBound(arr, target, desc = false) {
  let lo = 0, hi = arr.length
  if (desc) {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid] >= target) lo = mid + 1
      else hi = mid
    }
  } else {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid] <= target) lo = mid + 1
      else hi = mid
    }
  }
  return lo
}
