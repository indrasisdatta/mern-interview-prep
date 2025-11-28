/**
 * https://leetcode.com/problems/koko-eating-bananas/
 * @param {number[]} piles
 * @param {number} h
 * @return {number}
 */
var minEatingSpeed = function(piles, h) {
    let minSpeed = 1;
    let maxSpeed = Math.max(...piles);

    while (minSpeed < maxSpeed) {
        let mid = Math.floor((minSpeed + maxSpeed) / 2);
        if (canEatBananas(piles, h, mid)) {
            maxSpeed = mid;
        } else {
            minSpeed = mid + 1;
        }
    }
    return minSpeed;
};

function canEatBananas(piles, h, speed) {
    let time = 0;
    for (let pile of piles) {
        time += Math.ceil(pile/speed);
        if (time > h) return false;
    }
    return time <= h;
}