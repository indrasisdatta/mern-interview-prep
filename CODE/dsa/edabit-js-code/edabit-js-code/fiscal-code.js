/**
 * https://edabit.com/challenge/Pa2rHJ6KeRBTF28Pg
 *
 */
const months = { 1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "H",
7: "L", 8: "M", 9: "P", 10: "R", 11: "S", 12: "T" }
const vowels = ['A', 'E', 'I', 'O', 'U'];
const targetLen = 3;

const getConsonents = (str) => {
	return str
  	.split('')
    .filter(s => !vowels.includes(s.toUpperCase()))
    .map(s => s.toUpperCase())
}
const getVowels = (str) => {
	return str
  	.split('')
    .filter(s => vowels.includes(s.toUpperCase()))
    .map(s => s.toUpperCase())
}

const codeFromName = (person) => {
	let code = '';
	const cons = getConsonents(person.name);
  console.log('Consonents', cons);
  if (cons.length === 3) {
  	code = cons.slice(0, 3).join('');
  } else if (cons.length > 3) {
  	code = cons[0] + cons[2] + cons[3];
  } else {
    code = cons.join('');
  	const vow = getVowels(person.name);
    let i = 0;
    while (code.length < targetLen) {
    	code += typeof vow[i] !== 'undefined' ? vow[i] : 'X';
      i++;
    }    
  }
  console.log('Name code: ', code)
  return code;
}
const codeFromSurname = (person) => {
	let code = '';
	const cons = getConsonents(person.surname);
  console.log('Consonents', cons);
  code = cons.slice(0, 3).join('');
  if (cons.length < 3) {
  	const vow = getVowels(person.surname);
    let i = 0;
    while (code.length < targetLen) {
    	code += typeof vow[i] !== 'undefined' ? vow[i] : 'X';
      i++;
    }
  }
  console.log('Surname code: ', code)
  return code;
}
const codeFromDOB = (person) => {
	const [d, m, y] = person.dob.split('/');
  const code = y.slice(-2) + 
                months[m] + 
                (
                  person.gender == 'M' ? 
                  (d.length === 1 ? '0'+d : d) : Number(d) + 40
                );
  console.log('DOB code', code);
  return code;
}

function fiscalCode(person) {
		const code1 = codeFromSurname(person);
    const code2 = codeFromName(person);
    const code3 = codeFromDOB(person);
    console.log('--> Final code: ', code1+code2+code3)
    return code1 + code2 + code3;
}

fiscalCode({ name: "Al", surname: "Capone", gender: "M", dob: "17/1/1899" }) // "CPNLAX99A17"

fiscalCode({ name: "Marie", surname: "Curie", gender: "F", dob: "7/11/1867" })// "CRUMRA67S47"
