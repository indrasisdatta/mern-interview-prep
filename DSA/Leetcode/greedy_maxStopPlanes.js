/*
 Given two arrays A[] and B[] consisting of N integers where A[i] represents the initial position of the ith plane and B[i] is the speed at which the plane is landing, the task is to print the number of the plane that can be stopped from landing by shooting an aircraft at every second. 
 Examples: 
 Input: A[] = {1, 3, 5, 4, 8}, B[] = {1, 2, 2, 1, 2} 
 Output: 4
 * A - distance, B - speed 
 * time[i] = ceil(A[i] / B[i])
 */
function maximumStopPlanes(A, B) {
  if (A.length !== B.length) return -1;
  let landingTimes = [];
  for (let i = 0; i < A.length; i++) {
    landingTimes[i] = Math.ceil(A[i] / B[i]);
  }
  landingTimes = landingTimes.sort((a, b) => a - b);
  // console.log(landingTimes)
  let time = 1, count = 0;
  for (let landingTime of landingTimes) {
    if (time > landingTime) {
      break;
    }
    count++;
    time++;
  }
  return count;
}

console.log(maximumStopPlanes([1, 3, 5, 4, 8], [1,2,2,1,2]));

