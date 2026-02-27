/**
 * https://leetcode.com/problems/group-anagrams/
 * @param {string[]} strs
 * @return {string[][]}
 */
const groupAnagrams = function(strs) {
    if (!strs) return [""];
    let freqMap ={};
    for (let str of strs) {
      let currFreq = getFrequency(str);
      if (!freqMap.hasOwnProperty(currFreq)) {
        freqMap[currFreq] = [];
      }
      freqMap[currFreq].push(str);
    }
    return Object.values(freqMap).sort((a, b) => a[0].localeCompare(b[0]));
};

const getFrequency = (str) => {
  let freq = new Array(26).fill(0);
  for (ch of str) {
    freq[ch.charCodeAt() - 97]++; 
  }
  return freq.join('_');
}

console.log(groupAnagrams(["bdddddddddd","bbbbbbbbbbc"]));