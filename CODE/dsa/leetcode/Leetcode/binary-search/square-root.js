const squareRoot = (num) => {
  for (let i = 1; i < num/2; i++) {
    if (i * i === num) return i;
  }
  return null
}

const squareRootBin = (num) => {
  let start = 1, end = num; 
  while (start < end) { // 1, 12
    let mid = Math.floor((start + end) / 2); // 6
    let sq = mid * mid;
    if (sq === num) return mid;
    if (sq > num) {
      end = mid; // 5
    } else {
      start = mid + 1; // 4
    }
  }
  return null;
}
console.log(squareRootBin(184884258895036416));
// console.log(squareRoot(184884258895036416));