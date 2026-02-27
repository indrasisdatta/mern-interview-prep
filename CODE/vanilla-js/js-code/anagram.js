/**
 * Check if 2 strings are anagrams
 * str1 = 'hello', str2 = 'leohl' // true
 * str1 = 'test' str2 = 'este' // false
 */
const isAnagram = (str1, str2) => {
	str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();
	let charMap = new Map();
  let flag = true;
  if (str1.length !== str2.length) {
  	return false;
  }
  // For str1 - set frequency of each chacracter
	for (let chr of str1) {
  	if (charMap.has(chr)) {
    	charMap.set(chr, charMap.get(chr) + 1);
    } else {
    	charMap.set(chr, 1);
    }
  }
  //console.log(charMap)
  // For str2 - decrement if value is present
  for (let chr of str2) {
    //console.log('Check str', charMap.has(chr), chr)
    if (charMap.has(chr)) {
      // Freq not matching str1, set flag
      if (charMap.get(chr) <= 0) {
        flag = false;
        break;
      }
      charMap.set(chr, charMap.get(chr) - 1);
    } else {
      //console.log('charMap missing', chr)
      flag = false;
      break;
    }
  }
  return flag;
}

console.log(isAnagram('hello', 'leohl'));
console.log(isAnagram('test', 'este'));
console.log(isAnagram('sam', 'mpss'));
