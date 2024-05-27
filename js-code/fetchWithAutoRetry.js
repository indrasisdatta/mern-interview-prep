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



