import { Directive, Input, ElementRef, HostListener } from '@angular/core';

@Directive({
  selector: 'img[appImageFallback]', // Target only <img> tags with this attribute
  standalone: true
})
export class ImageFallbackDirective {
  // Allow the user to pass a specific fallback URL, or use a default
  @Input() appImageFallback: string = 'assets/images/default-avatar.png';

  constructor(private eRef: ElementRef) {}

  @HostListener('error')
  loadFallback() {
    const element: HTMLImageElement = this.eRef.nativeElement;
    element.src = this.appImageFallback;
  }
}

<img [src]="user.profilePic" appImageFallback alt="User Avatar">

<img [src]="product.heroImage" 
     appImageFallback="assets/images/product-placeholder.jpg" 
     alt="Product Image">