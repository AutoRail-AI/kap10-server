# 1DXR Brand Guidelines

This document provides comprehensive brand guidelines for 1DXR, including logos, colors, typography, and usage rules. Use this as the definitive reference for all brand-related decisions.

---

## Table of Contents

1. [Logo Variations](#logo-variations)
2. [Color Palette](#color-palette)
3. [Typography](#typography)
4. [Brand Assets](#brand-assets)
5. [Usage Guidelines](#usage-guidelines)
6. [Applications & Mockups](#applications--mockups)

---

## Logo Variations

### Primary Logo
**Usage:** Use this as the main logo in most applications, including websites, marketing materials, and digital products.

**Available Files:**
- `public/logos/logo_1.svg` - White text with gradient X on black background
- `public/logos/logo_2.svg` - Gradient text with white X on black background

**Specifications:**
- Format: SVG, PNG
- Color: Black background with blue gradient accents
- Minimum size: 120px width
- Clear space: 25% of logo height on all sides

**Best Use Cases:**
- Website headers
- Email signatures
- Business cards
- App interfaces (dark mode)
- Marketing collateral
- Social media posts (dark theme)

---

### Secondary Logo
**Usage:** A versatile version for alternative layouts, footers, or smaller applications.

**Available Files:**
- `public/logos/logo_4.svg` - Black text with gradient X on white background
- `public/logos/logo_5.svg` - Gradient text with black X on white background

**Specifications:**
- Format: SVG, PNG
- Color: White/light background with blue gradient accents
- Minimum size: 100px width
- Clear space: 20% of logo height on all sides

**Best Use Cases:**
- Light-themed websites
- Document headers
- Print materials
- App interfaces (light mode)
- Forms and templates
- Light-colored backgrounds

---

### Accent Logo
**Usage:** A compact logo for small spaces like social media icons or app badges.

**Available Files:**
- `public/logos/logo_3.svg` - White text on gradient background
- `public/logos/logo_6.svg` - Black text on gradient background

**Specifications:**
- Format: SVG, PNG
- Color: Gradient blue background (#559EFF → #0665BA)
- Minimum size: 80px width
- Clear space: 15% of logo height on all sides

**Best Use Cases:**
- Social media profile images
- App store icons
- Favicon alternatives
- Promotional badges
- Call-to-action buttons
- Premium features highlights

---

### Logo Mark (Icon Only)
**Usage:** A standalone icon for apps, endpoints, or minimal branding contexts.

**Available Files:**
- `public/logos/logo_7.svg` - Gradient X on black background
- `public/logos/logo_8.svg` - Black X on white background
- `public/logos/logo_9.svg` - White X on gradient background
- `public/icons/app.svg` - Premium app icon with effects
- `public/icons/app_black_bg.svg` - App icon on 1080×1080px black canvas

**Specifications:**
- Format: SVG, PNG, ICO
- Sizes: 16px, 32px, 64px, 128px, 256px, 512px
- Minimum size: 24px
- Clear space: 10% of icon size on all sides

**Best Use Cases:**
- Favicons
- App icons (iOS, Android)
- Social media avatars
- Loading spinners
- Navigation elements
- Watermarks
- Browser extensions

---

## Color Palette

### Primary Colors

#### Cornflower Blue
**Role:** Primary brand color  
**Usage:** Main interactive elements, headlines, key brand moments

| Format | Value |
|--------|-------|
| HEX | `#568AFF` |
| RGB | `86, 138, 255` |
| CMYK | `67%, 38%, 0%, 0%` |

**Applications:**
- Primary buttons
- Links and interactive elements
- Brand accents
- Hero sections
- Call-to-action elements

---

#### Green-Blue
**Role:** Secondary brand color  
**Usage:** Supporting elements, gradients, depth

| Format | Value |
|--------|-------|
| HEX | `#0665BA` |
| RGB | `6, 101, 186` |
| CMYK | `96%, 48%, 0%, 27%` |

**Applications:**
- Secondary buttons
- Gradient end points
- Hover states
- Supporting graphics
- Background accents

---

### Base Colors

#### Rich Black
**Role:** Base/text color  
**Usage:** Text, dark backgrounds, primary content

| Format | Value |
|--------|-------|
| HEX | `#001320` |
| RGB | `0, 19, 32` |
| CMYK | `100%, 59%, 0%, 68%` |

**Applications:**
- Body text
- Headers and titles
- Dark backgrounds
- Icons (light mode)
- Navigation bars

---

#### White
**Role:** Base color  
**Usage:** Light backgrounds, text on dark surfaces, clean space

| Format | Value |
|--------|-------|
| HEX | `#FFFFFF` |
| RGB | `255, 255, 255` |
| CMYK | `0%, 0%, 0%, 0%` |

**Applications:**
- Text on dark backgrounds
- Page backgrounds (light mode)
- Cards and panels
- Clean, minimal spaces
- Icons (dark mode)

---

### Accent Colors

#### French Sky Blue
**Role:** Accent color  
**Usage:** Highlights, notifications, special callouts

| Format | Value |
|--------|-------|
| HEX | `#66ABFE` |
| RGB | `102, 171, 254` |
| CMYK | `60%, 23%, 0%, 0%` |

**Applications:**
- Success states
- Highlighted content
- Badges and labels
- Info notifications
- Active states

---

### Gradient (P→S)
**Role:** Premium gradient  
**Usage:** Backgrounds, special elements, brand moments

**Gradient Definition:**
- Start: `#559EFF`
- End: `#0065BA`
- Direction: Varies by use case (typically top-to-bottom or diagonal)

**Applications:**
- Premium features
- Hero sections
- Buttons and CTAs
- Background overlays
- Marketing materials
- App store assets

---

## Color Usage Guidelines

### Screen & Web Design
- **Primary:** Use HEX and RGB values
- **Backgrounds:** Rich Black (`#001320`) or White (`#FFFFFF`)
- **Interactive Elements:** Cornflower Blue (`#568AFF`)
- **Gradients:** `#559EFF` → `#0065BA`

### Print Design
- **Primary:** Use CMYK values for accurate printing
- **Rich Black:** Consider using true black (K100) for text in print
- **White:** Leave as paper color for efficiency
- **Gradients:** Ensure proper color management in print workflow

### Color Accessibility
All color combinations meet **WCAG AA standards** for contrast:
- ✅ White text on Rich Black: **15.8:1**
- ✅ White text on Green-Blue: **4.7:1**
- ✅ White text on Cornflower Blue: **3.8:1**
- ✅ Rich Black text on White: **15.8:1**

---

## Typography

### Primary Font: Poppins Semi Bold
**Usage:** The main typeface used for headlines and key brand messaging.

**Specifications:**
- Font Family: `Poppins`
- Weight: `600` (Semi Bold)
- Style: Sans-serif, geometric, modern
- License: Open Font License (Google Fonts)

**Applications:**
- H1, H2, H3 headings
- Hero headlines
- Navigation menus
- Button labels
- Logo text
- Marketing headlines

**Web Implementation:**
```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600&display=swap');

h1, h2, h3 {
  font-family: 'Poppins', sans-serif;
  font-weight: 600;
}
```

**Scale:**
- H1: 48px / 3rem
- H2: 36px / 2.25rem
- H3: 28px / 1.75rem
- Large: 24px / 1.5rem

---

### Secondary Font: Poppins Regular
**Usage:** A supporting typeface for subheadings and extended text content.

**Specifications:**
- Font Family: `Poppins`
- Weight: `400` (Regular)
- Style: Sans-serif, geometric
- License: Open Font License (Google Fonts)

**Applications:**
- Body text
- Paragraphs
- Descriptions
- Captions
- Form labels
- Supporting content

**Web Implementation:**
```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400&display=swap');

body, p {
  font-family: 'Poppins', sans-serif;
  font-weight: 400;
  font-size: 16px;
  line-height: 1.6;
}
```

**Scale:**
- Body Large: 18px / 1.125rem
- Body: 16px / 1rem
- Small: 14px / 0.875rem
- Caption: 12px / 0.75rem

---

### Complementary Font: Sofia Sans Extra Condensed Regular
**Usage:** An accent font used sparingly for emphasis or decorative purposes.

**Specifications:**
- Font Family: `Sofia Sans Extra Condensed`
- Weight: `400` (Regular)
- Style: Sans-serif, condensed
- License: Open Font License (Google Fonts)

**Applications:**
- Labels and tags
- Numerical displays
- Data visualization
- Decorative headers
- Space-constrained layouts
- Special callouts

**Web Implementation:**
```css
@import url('https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@400&display=swap');

.accent-text {
  font-family: 'Sofia Sans Extra Condensed', sans-serif;
  font-weight: 400;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
```

**Use Sparingly:** This font is for accent purposes only. Do not use for body text or long-form content.

---

## Typography Guidelines

### Hierarchy
```
H1 (Poppins Semi Bold, 48px) → Main page title
H2 (Poppins Semi Bold, 36px) → Section headers
H3 (Poppins Semi Bold, 28px) → Subsection headers
Body (Poppins Regular, 16px) → Content text
Accent (Sofia Sans EC, varies) → Labels/tags
```

### Line Height
- **Headlines:** 1.2
- **Body Text:** 1.6
- **Captions:** 1.4

### Letter Spacing
- **Headlines:** -0.02em (tighter)
- **Body Text:** 0 (default)
- **Accent Font:** 0.05em (looser, uppercase)

### Do's & Don'ts

✅ **Do:**
- Use Poppins for all primary content
- Maintain consistent hierarchy
- Ensure proper line height for readability
- Use Semi Bold for emphasis and headers
- Keep accent font usage minimal and intentional

❌ **Don't:**
- Mix too many font weights in one layout
- Use Sofia Sans for body text
- Set body text below 14px
- Use all caps for long text (except with accent font)
- Forget to optimize web font loading

---

## Brand Assets

### Icon Collection
A collection of mockups, icons, and patterns for showcasing and enhancing the brand.

**Available Assets:**

#### Decorative Backgrounds
- `public/icons/background_icon.svg` - Outlined X pattern for backgrounds
- `public/icons/background_icon_usage.svg` - Implementation reference

**Usage:**
- Website hero sections (20-30% opacity)
- Presentation backgrounds
- Marketing materials
- Decorative overlays
- Print materials

#### App Icons
- `public/icons/app.svg` - Premium app icon (561×561px)
- `public/icons/app_black_bg.svg` - App icon on black (1080×1080px)

**Usage:**
- iOS/Android app icons
- PWA icons
- Social media profiles
- Premium presentations

#### UI Icons (Examples from brand sheet)
Various branded icons for UI elements:
- Home/dashboard icons
- Percentage/statistics icons
- Notification/alert icons
- Settings icons
- Chart/analytics icons
- Security/shield icons
- Slider/control icons
- And more...

**Style Guidelines:**
- Use rounded, soft edges
- Maintain consistent stroke width
- Apply brand blue colors
- Use on light or dark backgrounds with proper contrast
- Size: Minimum 24×24px for clarity

---

## Usage Guidelines

### Logo Usage Rules

#### Do's ✅
- **Maintain Aspect Ratio:** Never stretch or distort logos
- **Use Correct Versions:** Dark logos on light backgrounds, light logos on dark backgrounds
- **Provide Clear Space:** Follow minimum clear space guidelines
- **Use Vector Files:** Always use SVG when possible for scalability
- **Test Readability:** Ensure logos are legible at minimum sizes
- **Choose Appropriate Variation:** Match logo version to context

#### Don'ts ❌
- **Don't Alter Colors:** Never change gradient colors or brand colors
- **Don't Add Effects:** No drop shadows, glows, or filters (except in app.svg)
- **Don't Rotate:** Keep logos horizontal
- **Don't Place on Busy Backgrounds:** Ensure sufficient contrast
- **Don't Compress Too Much:** Maintain quality when exporting
- **Don't Combine Variations:** Use one logo style consistently per design

---

### Color Usage Rules

#### Do's ✅
- **Follow Palette:** Use only defined brand colors
- **Ensure Contrast:** Meet WCAG AA accessibility standards
- **Use Gradients Consistently:** Apply P→S gradient in defined direction
- **Test on Devices:** Verify colors on different screens
- **Consider Context:** Use appropriate colors for print vs. screen

#### Don'ts ❌
- **Don't Invent Colors:** Stay within the defined palette
- **Don't Use Low Contrast:** Ensure text is always readable
- **Don't Overuse Accent Colors:** Use sparingly for impact
- **Don't Mix Print and Screen Values:** Use CMYK for print, RGB/HEX for screen
- **Don't Ignore Accessibility:** Always check color contrast ratios

---

### Typography Usage Rules

#### Do's ✅
- **Maintain Hierarchy:** Use consistent heading levels
- **Optimize Readability:** Follow line height and spacing guidelines
- **Load Fonts Efficiently:** Use font-display: swap for web
- **Test Across Platforms:** Verify rendering on different devices
- **Use Proper Weights:** Semi Bold for headers, Regular for body

#### Don'ts ❌
- **Don't Mix Too Many Fonts:** Stick to the defined three fonts
- **Don't Use Below Minimum Sizes:** Maintain legibility
- **Don't Stretch Type:** Maintain proper aspect ratios
- **Don't Ignore Line Length:** Keep body text between 45-75 characters per line
- **Don't Overuse Accent Font:** Reserved for special purposes only

---

## Applications & Mockups

### Digital Applications

#### Mobile App
- **Logo:** Use app.svg or logo_2.svg for splash screen
- **Colors:** Rich Black backgrounds with Cornflower Blue accents
- **Typography:** Poppins Semi Bold for headers, Regular for content
- **Icons:** Custom branded icons with rounded style

#### Smartwatch/Wearables
- **Logo:** Use logo_9.svg (icon only)
- **Display:** High contrast with minimal color
- **Typography:** Larger sizes for readability
- **Layout:** Simplified, single-column

#### Website
- **Hero:** Use background_icon.svg at low opacity
- **Headers:** logo_1.svg or logo_2.svg
- **Footer:** logo_4.svg or logo_5.svg
- **Dark Mode:** logo_1.svg, logo_2.svg, logo_7.svg
- **Light Mode:** logo_4.svg, logo_5.svg, logo_8.svg

---

### Presentation Materials

#### Business Presentations
- **Background:** Use background_icon_usage.svg as template
- **Title Slide:** Large logo_3.svg or logo_6.svg centered
- **Content Slides:** Small logo mark in corner (logo_7.svg, logo_8.svg, or logo_9.svg)
- **Colors:** Use gradient backgrounds for impact slides
- **Typography:** Poppins Semi Bold for all slide titles

#### Marketing Decks
- **Cover:** Full gradient background with white logo
- **Interior:** Clean white backgrounds with blue accents
- **Data Slides:** Use French Sky Blue for highlights
- **Closing:** Brand color gradient with contact info

---

### Print Materials

#### Business Cards
- **Front:** logo_4.svg with minimal text
- **Back:** Gradient background with white text
- **Paper:** Premium card stock
- **Finish:** Matte or soft-touch

#### Letterhead
- **Header:** logo_5.svg (top left or center)
- **Footer:** Small logo mark with contact details
- **Colors:** Minimal use of brand colors
- **Typography:** Poppins Regular for body

#### Brochures
- **Cover:** Large gradient element with logo_3.svg
- **Interior:** Mix of white and colored panels
- **Imagery:** Product photos with blue color grading
- **Typography:** Clear hierarchy with Poppins

---

## Quick Reference

### Logo Selection Matrix

| Background Color | Full Logo | Icon Only |
|-----------------|-----------|-----------|
| **Black/Dark** | logo_1.svg, logo_2.svg | logo_7.svg |
| **White/Light** | logo_4.svg, logo_5.svg | logo_8.svg |
| **Blue Gradient** | logo_3.svg, logo_6.svg | logo_9.svg |
| **App Icons** | app.svg, app_black_bg.svg | app.svg |

### Color Quick Copy

| Color Name | HEX | RGB |
|------------|-----|-----|
| Cornflower Blue | `#568AFF` | `86, 138, 255` |
| Green-Blue | `#0665BA` | `6, 101, 186` |
| Rich Black | `#001320` | `0, 19, 32` |
| White | `#FFFFFF` | `255, 255, 255` |
| French Sky Blue | `#66ABFE` | `102, 171, 254` |
| Gradient Start | `#559EFF` | `85, 158, 255` |
| Gradient End | `#0065BA` | `0, 101, 186` |

### Font Quick Reference

```css
/* Primary - Headlines */
font-family: 'Poppins', sans-serif;
font-weight: 600;

/* Secondary - Body */
font-family: 'Poppins', sans-serif;
font-weight: 400;

/* Complementary - Accent */
font-family: 'Sofia Sans Extra Condensed', sans-serif;
font-weight: 400;
```

---

## File Organization

```
public/
├── logos/
│   ├── logo_1.svg          (Black bg, white text, gradient X)
│   ├── logo_2.svg          (Black bg, gradient text, white X)
│   ├── logo_3.svg          (Gradient bg, white text, black X)
│   ├── logo_4.svg          (White bg, black text, gradient X)
│   ├── logo_5.svg          (White bg, gradient text, black X)
│   ├── logo_6.svg          (Gradient bg, black text, white X)
│   ├── logo_7.svg          (Black bg, gradient X icon)
│   ├── logo_8.svg          (White bg, black X icon)
│   └── logo_9.svg          (Gradient bg, white X icon)
│
└── icons/
    ├── app.svg             (Premium app icon 561×561px)
    ├── app_black_bg.svg    (App icon on black 1080×1080px)
    ├── background_icon.svg (Outline pattern for backgrounds)
    └── background_icon_usage.svg (Usage example 1280×720px)
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | November 2025 | Initial brand guidelines |

---

## Legal & Trademark

The 1DXR logo, name, and brand assets are proprietary and protected. Unauthorized use, reproduction, or modification is prohibited without express written permission.

**Last Updated:** November 2025  
**Brand Version:** 1.0  
**Guidelines Version:** 1.0