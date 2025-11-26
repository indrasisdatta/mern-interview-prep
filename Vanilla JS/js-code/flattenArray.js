const arr = [1, 2, 3, [4, 5, [6, 7]], 8];

const flatMap = (origArr, tempArr = []) => {
	origArr.map(a => {
  	if (Array.isArray(a)) {
    	tempArr = flatMap(a, tempArr);
      // console.log('Temp arr type', tempArr)
      return tempArr;
    } else {
    	tempArr = [...tempArr, a];
      // console.log('Temp num type', tempArr)
    }
  })
  // console.log('Temp arr: ', tempArr)
  return tempArr;
}

function flattenArray(a) {
	return flatMap(a);
}

console.log(flattenArray(arr));
