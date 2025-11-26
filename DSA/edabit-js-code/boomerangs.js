/**
 * https://edabit.com/challenge/b7iHQDw72zzkmgCun
 * Example 1: 
 *   [3, 7, 3, 2, 1, 5, 1, 2, 2, -2, 2]
 *   3 boomerangs in this sequence:  
 *   [3, 7, 3], [1, 5, 1], [2, -2, 2]
 * Example 2:
 *   [1, 7, 1, 7, 1, 7, 1]
 *   5 boomerangs (from left to right): 
 *   [1, 7, 1], [7, 1, 7], [1, 7, 1], [7, 1, 7], and [1, 7, 1]
 */
 
function countBoomerangs(arr) {
	const boomerangs = [];
  arr.forEach((val, key) => {
  	if (typeof arr[key+1] === 'undefined' || typeof arr[key+2] === 'undefined') {
    	return;
    }
    let first = val,
    	  second = arr[key+1],
        third = arr[key+2];
        
    if (second - first === second - third && first !== second && third !== second) {
    	boomerangs.push([first, second, third]);
    }
  });  
  return boomerangs.length;
}
