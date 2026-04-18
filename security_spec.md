# Security Specification for Cal AI

## Data Invariants
1. **Ownership Integrity**: Every document in `users`, `meals`, `workouts`, and `steps` MUST be owned by the authenticated user.
2. **Relational Constraints**: Sub-documents (meals, workouts, steps) must inherit access from the parent user document.
3. **Type Strictness**: All numeric fields must be validated for type and range.
4. **Temporal Integrity**: `createdAt` and `updatedAt` timestamps must match the server time (`request.time`).

## The "Dirty Dozen" Payloads (Deny Cases)
1. **Self-Promotion**: Authenticated user trying to overwrite another user's profile ID.
2. **Shadow Field Injection**: Adding `isAdmin: true` to a profile update.
3. **Future Dating**: Setting a `timestamp` in the future.
4. **Weight Forgery**: Setting a negative weight or a weight over 1000kg.
5. **Calorie Spiking**: Setting `caloriesBurned` to 1,000,000 in a single workout.
6. **Identity Spoofing**: `addDoc` to `users/different-user/meals`.
7. **Bypassing Verification**: Writing to Firestore without `email_verified == true`.
8. **Malicious IDs**: Using a 1MB string as a document ID.
9. **Update Gap**: Changing the `calories` of a meal but not the `name`, potentially desyncing AI metadata.
10. **Terminal State Lock**: Modifying a historical log that should be immutable (if implemented).
11. **Negative Macros**: Setting `protein: -50`.
12. **Orphaned Records**: Creating a workout for a user ID that hasn't been onboarded.

## Verification
Rules will be tested for:
- `get` / `list` access control.
- `create` / `update` validation.
- `diff().affectedKeys().hasOnly()` compliance.
