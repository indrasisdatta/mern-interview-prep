function search(nums, target) {
    return modifiedBinarySearch(nums, target, 0, nums.length - 1);
}

function modifiedBinarySearch(arr, target, left, right) {
    if (left > right) return -1;

    let mid = Math.floor((left + right) / 2);

    if (arr[mid] === target) return mid;

    // Left sorted portion
    if (arr[left] <= arr[mid]) {
        if (target >= arr[left] && target <= arr[mid]) {
            return modifiedBinarySearch(arr, target, left, mid - 1);
        }
        return modifiedBinarySearch(arr, target, mid + 1, right);
    }

    // Right sorted portion
    else {
        if (target >= arr[mid] && target <= arr[right]) {
            return modifiedBinarySearch(arr, target, mid + 1, right);
        }
        return modifiedBinarySearch(arr, target, left, mid - 1);
    }
}
