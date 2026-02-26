/** 
 * Create a fetchWithAutoRetry(fetcher, count)
 * which automatically fetch again when error happens, 
 * until the maximum count is met.
 */
async function fetchWithAutoRetry(fetcher, maximumRetryCount) {
     console.log(`fetchWithAutoRetry ${maximumRetryCount}`, fetcher);
    try {
        console.log(`Try block attempt ${maximumRetryCount}`);
    	const tempFetcher = await fetcher(maximumRetryCount);
    	return tempFetcher;
    } catch (e) {
    	console.error(`Catch block Retry #{maximumRetryCount} - Error caught: `, e);
        return fetchWithAutoRetry(fetcher, maximumRetryCount-1);
    }
}

const fetcher = (retryCount) => {
  return new Promise((resolve, reject) => {
      if (retryCount === 2) resolve('Resolved value 2')
      reject('Rejected value')
  })
}

(async() => {
    try {
         const result = await fetchWithAutoRetry(fetcher, 5);
         console.log('Final result: ', result)
    } catch (e) {
        console.error('Main async error: ', e)
    }
})();


/* Exponential backoff */

const delayCall = (delayTime) => {
  console.log('Delay time: ', delayTime)
  return new Promise(resolve => setTimeout(resolve, delayTime));
}

const retry = async (callback, retryAttempt=1, maxRetries=4) => {
  // 2^2 * 100, 2^3 * 100 ... -> 100ms, 200ms, 400ms, 800ms
  const delayTime = 2 ** (retryAttempt - 1) * 1000;
  try {
    // Add delay for 2nd attempt onwards
    if (retryAttempt > 1) {
      await delayCall(delayTime);
    }
    return await callback(retryAttempt);
  } catch (e) {
    if (retryAttempt < maxRetries) {
      return await retry(callback, retryAttempt+1);
    } 
    console.error('Reached maximum retry limit.. ' + e.message);
  }
};

const fakeApiCall = async (count) => {
  console.log("API call: ", count);
  if (count < 3) {
    return Promise.reject("Promise Error API call");
  }
  return Promise.resolve("Promise Success API call");
}


(async() => {
  await retry(fakeApiCall);
  console.log('Finished!');
})();

/* ------------------------------- */

/* Auto retry implementation */

const retryApi = async (fn, retryCount) => {
  return async (...args) => {
    let attempts = retryCount;
    while (attempts > 0) {
      try {
        return await fn(...args, attempts);
      } catch(e) {
        attempts--;
        if (attempts === 0) throw e;
      }
    }
  }
}

const apiCall = async (a, b, retryCount) => {
  console.log('Promise', a, b, retryCount)
  return new Promise((resolve, reject) => {
    if (retryCount === 3) {
      resolve("Promise Success!", a, b);
      return;
    }
    reject("Promise error!");
  });
}

(async() => {
  const retryApiFunc = await retryApi(apiCall, 4);
  const response = await retryApiFunc('one', 'two');
  console.log('Final response', response)
})();








