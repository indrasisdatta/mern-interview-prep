/**
 * https://edabit.com/challenge/y8fTF8GBMAXTdkrkH
 *
 */
 const recurIndex = (str) => {
 	if (!str) {
  	return {};
  }
  let tmpFreq = {};
  let result = {};
  for (let i in str) {
  	let ch = str[i];
  	if (tmpFreq.hasOwnProperty(ch)) {
    	result = { [ch]: [tmpFreq[ch], i] };
      break;
    } else {
    	tmpFreq[ch] = i;
    }
  }
  console.log(result)
  return result;
 }
 
 
 recurIndex("DXTDXTXDTXD") // {"D": [0, 3]}
// D first appeared at index 0, resurfaced at index 3
// T appeared and resurfaced at indices 3 and 6 but D completed the cycle first

recurIndex("YXZXYTUVXWV")// {"X": [1, 3]}
recurIndex("YZTTZMNERXE")// {"T": [2, 3]}
recurIndex("AREDCBSDERD")// {"D": [3, 7]}
recurIndex("")// {}
recurIndex(null)// {}
