/** 
 * https://edabit.com/challenge/HXAWjd2Nkj8eAJ2xY
 * Jake eats 
 *  - breakfast at 7:00 a.m
 *  - lunch at 12:00 p.m
 *  - dinner at 7:00 p.m
 * Create a function that takes in the current time as a string
 * and determines the duration of time before Jake's next meal. 
 */
const timeToEat = (inputTime) => {
	let nextMealTime = [];
	const mealTimes = [7, 12, 19];
  /* Invalid input */
  console.log(inputTime)
  if (
  	!inputTime || 
  	(
    	inputTime && 
      (!inputTime.includes('a.m.') && !inputTime.includes('p.m.'))
    )
  ) {
  	return [];
  }
  let [hh, mm] = inputTime.split(':');
  if (mm.includes('a.m.')) {
  	 hh = Number(hh);
  	 mm = Number(mm.replace(' a.m.', ''));
  } else {
  	hh = Number(hh) + 12;
    mm = Number(mm.replace(' p.m.', ''));
  }
  console.log(hh, mm)
  let currentMins = hh * 60 + mm;
  let k = 0;
  let loopFlag = true;
  while (loopFlag) {
  	let mealTime = mealTimes[k];
    /* Passed last meal time, so consider next day's meal time */
    if (k === 2 && currentMins >= mealTime * 60) {
    	nextMealTime = timeDiff(currentMins, 24 * 60);
      nextMealTime[0] += mealTimes[0];
      loopFlag = false;
      break;
    }
  	if (currentMins < mealTime * 60) {
    	nextMealTime = timeDiff(currentMins, mealTime * 60);
      loopFlag = false;
      break;
    }
    if (k > mealTimes.length - 1) {
    	loopFlag = false;	
    	break;
    }
    k++;
  }
  console.log('Next meal at: ', nextMealTime)
  return nextMealTime;
}

const timeDiff = (start, end) => {
	let diffMins = end - start;
  return [Math.floor(diffMins/60), diffMins % 60]
}


/* timeToEat("2:00 p.m.");
timeToEat("5:50 a.m.");
timeToEat("6:37 p.m.");
timeToEat("12:00 a.m."); */
timeToEat("11:58 p.m.");
/* timeToEat("3:33 p.m."); */


/* ALT Soln */
function timeToEatAlt(currentTime) {
	let [h,m,am] = currentTime.split(/[: ]/);
	[h,m] = [+h,+m];
	if (h === 12) { h -= 12; }
	if (am === "p.m.") { h += 12; }
	let time = 60*h + m;
	let r = [420, 720, 1140, 1860].map(v => v - time).filter(v => v >= 0);
	r = Math.min(...r);
	return [~~(r/60), r % 60];
}
