/**
 * https://edabit.com/challenge/xPBFGvKQfRFEyy4vx
 * 
 */
 const validName = (str) => {
 	let [ first, middle, last ] = str.split(' ');
  if (!last) {
  	last = middle;
  	middle = '';    
  }
  console.log(first, middle, last) 
  
  if (!middle && !last) {
  	console.log('Single names are not allowed');
    return false;
  }
  else if (last.length === 1 || (last.length === 2 && last.includes('.'))) {
    console.log('last name is not a word');
    return false;
  
 } else if (
    (first.length === 1 && !first.includes('.')) || 
    (middle.length === 1 && !middle.includes('.'))
   ) {
    console.log('initials must end with dot');
     return false;
   } else if (
    (first.charCodeAt(0) >= 97 && first.charCodeAt(0) <= 122) || 
    (middle && middle.charCodeAt(0) >= 97 && middle.charCodeAt(0) <= 122) || 
    (last.charCodeAt(0) >= 97 && last.charCodeAt(0) <= 122)
   ) {
      console.log('incorrect capitalization');
     return false;
   } else if (
    (first.length === 2 && first.includes('.')) &&
    (middle && middle.length > 2)
   ) {
    console.log('middle name expanded, while first still left as initial');
    return false; 
   } else if (
    (first.length > 2 && first.includes('.')) ||
    (middle && middle.length > 2 && first.includes('.')) || 
     (last.length > 2 && last.includes('.'))
   ) {
    console.log('dot only allowed after initial, not word');
    return false; 
   }
   console.log('TRUE');
 	return true;
 }
 
validName("H Wells")


 
/* validName("H. Wells")// true
validName("H. G. Wells") // true
validName("Herbert G. Wells")// true
validName("Herbert") // false
// Must be 2 or 3 words
validName("h. Wells") // false
// Incorrect capitalization
validName("H Wells") // false
// Missing dot after initial
validName("H. George Wells") // false
// Cannot have: initial first name + word middle name
validName("H. George W.") // false
// Last name cannot be initial
validName("Herb. George Wells") // false
// Words cannot end with a dot (only initials can) */
 
 
/* ALT SOlution */ 
const isWrongLength = terms => ![2, 3].includes(terms.length);
const isNotCapitalized = term => !term[0].match(/[A-Z]/);
const isDotlessInitial = term => term.length === 1;
const isWordWithDot = term => term.length > 2 && term.includes('.');
const endsWithInitial = terms => terms.slice(-1)[0].includes('.');
const onlyFirstOfThreeIsInitial = terms => (terms.length === 3) && terms[0].includes('.') && !terms[1].includes('.');

const validNameAlt = name => {
	const terms = name.split(' ');
	
	if (
		isWrongLength(terms)
		|| terms.some(term =>
			isNotCapitalized(term)
			|| isDotlessInitial(term)
			|| isWordWithDot(term)
		)
		|| endsWithInitial(terms)
		|| onlyFirstOfThreeIsInitial(terms)
	) {
		return false;
	}

	return true;
};
