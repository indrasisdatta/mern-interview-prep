/*
Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals and return an array of the non-overlapping intervals that cover all the intervals in the input.
Example:
Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]
Explanation: Since intervals [1,3] and [2,6] overlap, merge them into [1,6].
Overlap case: [start1, end1], [start2, end2]  -> end1 >= start2 then set [start1, end2]
 */
// [1,4] with [2,5] -> Overlap found, so merge [1,5]
// [1,5] with [3,7] -> Overlap found, so merge  [1,7]
// [1,7] with [15,18] -> No overlap found, so push [1,7], 15,18

const nonOverlapping = (arr) => {
  if (!arr || arr.length === 0) {
    console.error("Invalid input");
    return;
  }
  let result = [arr[0]];
  let i = 1, lim = arr.length;
  while (i < lim) {
    // Length should always be 2
    if (!arr[i] || arr[i].length !== 2) {
      console.error("Invalid length");
      result = [];
      break;
    }
    // Overlap condition 
    let lastElm = result[result.length - 1];
    let [start1, end1] = arr[i];
    // Result [1,4] with [2,5] -> Overlap found, so merge [1,5]
    if (lastElm[1] >= start1) {
      result[result.length - 1] = [lastElm[0], end1];
    } else {
      result.push([start1, end1]);
    }
    i++;
  }
  console.log('Result', result);
}

nonOverlapping([[1,3],[2,6],[8,10],[15,18]])

nonOverlapping([[1,4],[2,5],[3,7],[15,18]])
// [1,4] with [2,5] -> Overlap found, so merge [1,5]
// [1,5] with [3,7] -> Overlap found, so merge  [1,7]
// [1,7] with [15,18] -> No overlap found, so push [1,7], 15,18

// 1,5   3,7   15,18 -> 1,7  15,18



