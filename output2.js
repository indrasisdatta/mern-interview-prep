// Approach 1 using function call: Without changing var to let, how to print correct numbers
for (var i = 0; i < 3; i++) {
	function print(i) {
	    setTimeout(() => {
	      console.log(i)
	    }, 100)
	  }
	  print(i); 
}
// Approach 2 using IIFE: Without changing var to let, how to print correct numbers
for (var i = 0; i < 3; i++) {
  /* Workaround 2 */
  (function(i) {
  	setTimeout(() => {
      console.log(i)
    }, 100)
  })(i)  
}

let person = { name: 'ABC' };
const people = [person];
person = null;
console.log(people);

function checkUser(userObj) {
	if (userObj === {userId: 1}) {
  	console.log('Case 1 User found')
  } else if (Object.is(userObj, {userId: 1})) {
  	console.log('Case 2 User found')
  } else {
  	console.log('User not found')
  }
}

checkUser({userId: 1});


function getInfo(one, two, three, four) {
	console.log('getInfo', one, two, three, four);
}
const name = 'Mike';
const role = 'Developer'
const empId = 123;
getInfo`${name} is ${role} ${empId}`

/* Custom method for string */
String.prototype.fullName = function() {
	return `My name is ${this}`;
}
const name = "Indrasis";
console.log(name.fullName())

/* Arrow function doesn't have this, so doesn't have prototype chain */
const printArrow = () => 'Arrow func';
const print = function() { return 'Func'; }
console.log(printArrow.prototype, print.prototype);



