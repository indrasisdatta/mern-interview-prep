class LocalStorageManager {

  _ttl;

  constructor(ttl=3000) {
    this._ttl = ttl;
  }

  getItem(key) {
    if (localStorage.getItem(key)) {
      const val = JSON.parse(localStorage.getItem(key));
      if (val.expiryTime <= new Date().getTime()) {
        return val.data;
      }
      console.error('Local storage has expired');
      return null;
    }
    console.error('Local storage not found');
    return null;
  }

  setItem(key, val) {
    const value = {
      expiryTime: new Date().getTime() + this._ttl,
      data: val
    }
    localStorage.setItem(key, JSON.stringify(value));
  }
}

const storage = new LocalStorageManager(40);
storage.setItem('test_ls', 1234);

let count = 0;
const interval = setInterval(() => {
  console.log(storage.getItem('test_ls'));
  count++;
  if (count > 10) {
    console.log('---- Stop execution ----')
    clearInterval(interval);
  }
}, 5000);



