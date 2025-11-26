/**
 * Checking sum zero
 * i/p: [-5, -4, -3, -2, 0, 2, 4, 6, 8]
 * o/p: [-4, 4]
 */
 const sumZero = (arr) => {
   let start = 0, end = 1;
   let pair = null;
   while (start < end && end < arr.length) {
     // Match found
   	 if (arr[start] + arr[end] === 0) {
     	console.log('Match found')
    	pair = [ arr[start], arr[end] ];
      break;
     }
     // End reached limit, reset start and end
     if (end === arr.length - 1) {
     	console.log('End Reached limit')
     	start++;
      end = start + 1;
     }
     end++;
     console.log(start, end)
   }
   return pair;
 }
 
 console.log(sumZero([-5, -4, -3, -2, 0, 2, 4, 6, 8]))
