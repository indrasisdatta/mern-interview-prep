const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') {
    console.error("Invalid type");
    return;
  }
  let clone = Array.isArray(obj) ? [] : {};
  for (let index in obj) {
    if (obj.hasOwnProperty(index)) {
      let val = obj[index];      
      clone[index] = typeof val === 'object' && val !== null ? 
        deepClone(val) : val;
    }
  }
  // if (Object.keys(obj).length > 0) {
  //   Object.keys(obj).map(index => {
  //     let val = obj[index];      
  //     clone[index] = typeof val === 'object' && val !== null ? 
  //       deepClone(val) : val;
  //   });
  // }
  return clone;
}

const first = {id: 1, name: 'First'};
const first_clone = deepClone(first);

const second = {id: 2, name: 'Second', data: [1, 5, 6]};
const second_clone = deepClone(second);

const third = {
  id: 3, 
  name: 'Third', 
  dataObj: { 
    thirdAttr: {
      child: 'C1'
    }  
  }
};
const third_clone = deepClone(third);

console.log(first, first_clone)
console.log(second, second_clone)
console.log(third, third_clone)

