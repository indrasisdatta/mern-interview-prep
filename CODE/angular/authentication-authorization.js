@Injectable({ providedIn: 'root' })
export class AuthService {
  // 1. Create a private BehaviorSubject (Initial value is null)
  private tokenSubject = new BehaviorSubject<string | null>(null);

  private userRoles$ = new BehaviorSubject<string[]>(['EDITOR']); // Example initial state

  // 2. Expose it as an Observable (Read-only for components)
  token$ = this.tokenSubject.asObservable();

  // Helper to get current value without subscribing
  get currentToken(): string | null {
    return this.tokenSubject.value;
  }

  hasRole(expectedRoles: string[]): boolean {
    const currentRoles = this.userRoles$.value;
    return expectedRoles.some(role => currentRoles.includes(role));
  }

  setToken(token: string) {
    this.tokenSubject.next(token);
  }

  refreshToken() {
    return this.http.post<{accessToken: string}>('/api/refresh', {}, { withCredentials: true });
  }
}




export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  let isRefreshing = false;
  const refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);

  const token = authService.currentToken;

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
      withCredentials: true
    });
  }

  return next(req).pipe(
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        return handle401Error(req, next, authService, isRefreshing, refreshTokenSubject);
      }
      return throwError(() => error);
    })
  );
};

// Helper function to handle the refresh logic
function handle401Error(req: HttpRequest<any>, next: HttpHandlerFn, authService: AuthService, isRefreshing: boolean, refreshTokenSubject: BehaviorSubject<any>) {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshTokenSubject.next(null);

    return authService.refreshToken().pipe(
      switchMap((res: any) => {
        isRefreshing = false;
        authService.setToken(res.accessToken);
        refreshTokenSubject.next(res.accessToken);
        
        return next(req.clone({
          setHeaders: { Authorization: `Bearer ${res.accessToken}` }
        }));
      }),
      catchError((err) => {
        isRefreshing = false;
        // If refresh fails, log out user
        return throwError(() => err);
      })
    );
  } else {
    // If we are already refreshing, wait for the new token
    return refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap((token) => next(req.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
      })))
    );
  }
}

// Authorization - Route guard with observable
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // We map the token observable to a boolean
  return authService.token$.pipe(
    take(1), // Take the latest value and complete
    map(token => {
      if (token) return true;
      return router.parseUrl('/login');
    })
  );
};

// Role guard
export const roleGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  // Retrieve 'expectedRoles' defined in the route config
  const expectedRoles = route.data['roles'] as string[];

  // 2. Check Authentication first
  if (!authService.isAuthenticated()) {
    return router.parseUrl('/login');
  }

  if (authService.hasRole(expectedRoles)) {
    return true;
  }

  return router.parseUrl('/unauthorized');
};


// Route 
{ 
  path: 'admin-panel', 
  component: AdminComponent, 
  canActivate: [roleGuard], 
  data: { roles: ['ADMIN'] } 
}

<button *ngIf="authService.hasRole(['ADMIN', 'EDITOR'])" (click)="deleteItem()">
  Delete
</button>