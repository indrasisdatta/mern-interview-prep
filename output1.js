/* -------------- Question 1 -------------- */
const empObj = {
	department: "Software",
	getDepartment: function() {
  	console.log('1', this.department)
  },
  getDepartment2: () => {
  	console.log('2', this.department)
  },
  getDepartment3: (function(){	
  	console.log('3', this.department)
  })()
}

empObj.getDepartment(); // Software
empObj.getDepartment2(); // undefined
empObj.getDepartment3(); // undefined

/* -------------- Question 2 -------------- */
const emp = {
	fullName: 'Emp1',
  display: function() {
  	console.log(this.fullName);
  }
}
setTimeout(emp.display, 2000) // undefined

// Fix (can't use call as that would be executed immediately)
setTimeout(emp.display.bind(emp), 2000);

/* -------------- Question 3-------------- */
const obj = Object.create({
	fullName: "Object 1"
});
console.log(obj.fullName);
delete obj.fullName; // stored inside prototype, so doesn't work
console.log(obj.fullName);

const obj2 ={
	fullName: "Object 2"
};
console.log(obj2.fullName);
delete obj2.fullName;
console.log(obj2.fullName);

