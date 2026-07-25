# Flutter and Dart implementation guidance

- Treat official Flutter architecture guidance as adaptable: separate UI and data concerns; add a domain/use-case layer only when complexity earns it.
- Keep widgets focused on rendering and forwarding user intent. Put non-trivial state transitions in a pure Dart reducer, model, or use case.
- Use a ViewModel/controller for UI state and commands when a widget would otherwise accumulate behavior.
- Use repositories as sources of truth and services for external APIs/platform plugins when data boundaries exist.
- Keep domain code independent of Flutter imports where practical.
- Prefer `final`, immutable values, `const` constructors, sealed classes, and exhaustive pattern matching.
- Avoid a one-member abstract class when a function is sufficient. Define interfaces for real capabilities, not ceremony.
- Use SDK state tools such as `ChangeNotifier` for simple local needs; add a state-management package only for demonstrated requirements.
- Test pure Dart policy with unit tests, views with widget tests, adapters with integration/contract tests, and a few critical flows end to end.
- Keep `BuildContext`, platform channels, plugins, and navigation at the UI/adapter boundary.
