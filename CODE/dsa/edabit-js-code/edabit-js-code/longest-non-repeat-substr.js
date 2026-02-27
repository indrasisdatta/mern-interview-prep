function longestNonrepeatingSubstring(str) {
	let tempNonRepeat = '', 
      longestNonRepeat = '';
  for (let ch of str) {
  	if (tempNonRepeat.includes(ch)) {
      // First appearance of ch
    	let firstAppearancePos = tempNonRepeat.indexOf(ch) + 1;
    	// Remove everything before repeating char
      tempNonRepeat = tempNonRepeat.slice(firstAppearancePos);
    }
    tempNonRepeat += ch;
    if (tempNonRepeat.length > longestNonRepeat.length) {
    	longestNonRepeat = tempNonRepeat;
    }
  }
  return longestNonRepeat;
}
