/** 
* Write a program that returns true if the string contains the same frequency for every character. 
* Otherwise, return false. 
*/
/** 
 * Ref: https://unstop.com/blog/nagarro-interview-questions
 * Write a program that returns true if the string contains the same frequency for every character. 
 * Otherwise, return false. 
 */
const findStringFrequency = (str) =>  {
  const freqObj = {};
  let sameFlag = true;
  for (let ch of str) {
    if (freqObj.hasOwnProperty(ch)) {
      freqObj[ch]++;
    	sameFlag = false;
      break;
    }
    freqObj[ch] = 1;
  }
  console.log(freqObj);
  return sameFlag;
}
console.log(findStringFrequency('test')); // false
console.log(findStringFrequency('abc')); // true


