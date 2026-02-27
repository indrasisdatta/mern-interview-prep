const firstNonRepeatingChar = (str) => {
	let len = str.length;
  const charMap = new Map();
  /* For non-repeating, keep a true flag */
  for (let i = 0; i < len; i++) {
  	let chr = str.charAt(i);
  	if (charMap.has(chr)) {
    	charMap.set(chr, false);
    } else {
    	charMap.set(chr, true);
    }
  }  
  /* Find the first non-repeating char with true flag */
  let firstNonRepeat = null;
  for (let [chr, flag] of charMap) {
  	if (flag) {
      firstNonRepeat = chr;
      break;
    }
  }
  return firstNonRepeat;
}

const str = 'the quick brown a fox jumps then quickly blow air';
console.log(firstNonRepeatingChar(str)); // f
