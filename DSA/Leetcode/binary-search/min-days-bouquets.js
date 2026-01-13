/**
 * 1482. Minimum Number of Days to Make m Bouquets
 * https://leetcode.com/problems/minimum-number-of-days-to-make-m-bouquets/
 * @param {number[]} bloomDay
 * @param {number} m
 * @param {number} k
 * @return {number}
 */
var minDays = function(bloomDay, m, k) {

    if (m * k > bloomDay.length) {
        return -1;
    }
    
    let low = Math.min(...bloomDay);
    let high = Math.max(...bloomDay);
    let minBloomDay = 0;
    
    while (low < high) {
        let mid = Math.floor((low + high) / 2); // 1, 10 -> mid = 5
        let formedBouquets = formBouquet(mid);
        if (formedBouquets < m) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }    

    // [7,7,7,7,12,7,7] low = 7, high = 12, mid = 9

    function formBouquet(mid) {
        let flowers = 0, bouquets = 0;
        for (let day of bloomDay) {
            // if (bouquets >= m) break;            
            if (day <= mid) {
                flowers++;
                if (flowers === k) {
                    bouquets++;
                    flowers = 0;
                }
            } else {
                flowers = 0;
            }
        }
        // return bouquets === m;
        return bouquets;
    }

    return low;
};