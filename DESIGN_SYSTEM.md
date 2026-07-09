# bevcrew design system

This file keeps the app from drifting into random one-off UI decisions.

## Core rules

- Use the shared tokens in `designSystem.js` for color, spacing, radius, typography, and layout.
- Use the 4/8 spacing rhythm. Most spacing should come from `spacing` values.
- Keep one strong brand action color: green.
- Use coral/red only for secondary emphasis, destructive actions, or category accents.
- Keep surfaces plain. Avoid random gradients, glass effects, and one-off shadows.
- Every major section should feel like the same product: rounded card, border, consistent padding.

## Layout rules

- Screen padding: `layout.pagePadding`.
- Card padding: `layout.cardPadding`.
- Primary buttons should be 48px tall.
- Feed images stay 4:5.
- Bottom nav stays simple: Feed, centered plus button, Profile.
- History stays inside Profile instead of becoming a competing main tab.

## UX rules

- One primary action per screen.
- Keep helper text short.
- Do not hide required choices behind horizontal scrolling.
- Use segmented controls for simple two-option switches like Crew / Explore.
- Use toast feedback for lightweight success states.
- Avoid alert boxes unless something actually failed.

## Component direction

When the app grows, split repeated UI into reusable components:

- `AppButton`
- `SectionCard`
- `SegmentedControl`
- `PostCard`
- `ReactionRow`
- `RatingGrid`
- `BottomNav`
- `ProfileStats`

Do not create a new visual style for each new feature. Extend the existing tokens first.
