const removeDuplicates = (arr) => {
  /* Store frequency of each no in this map */
  let elementMap = new Map();
  for (let num of arr) {
    if (elementMap.has(num)) {
      let freq = elementMap.get(num);
      elementMap.set(num, freq+1);
    } else {
      elementMap.set(num, 1);
    }
  }
  /* From map, find elements which occurs more than once */
  return Array.from(elementMap)
              .filter(([num, freq]) => {
                return freq > 1;
              })
              .reduce((acc, cur) => {
                console.log(acc, cur[0])
                return [...acc, cur[0]]
              }, [])
  
}

const arr = [1, 12, 1, 5, 34, 2, 1, 34, 14, 65, 5, 65, 76, 65, 76, 76];
console.log(removeDuplicates(arr));
