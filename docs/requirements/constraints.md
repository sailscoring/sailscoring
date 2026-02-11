# Constraints

Technical, regulatory, and user experience boundaries that shape the system design.

## Technical Constraints

### Deployment Environment

| Constraint | Description | Rationale |
|------------|-------------|-----------|
| _Example: Offline capability_ | _Must function without internet_ | _Race venues often lack connectivity_ |
| | | |

### Platform/Device Support

| Platform | Required | Notes |
|----------|----------|-------|
| Desktop browser | _Yes/No/TBD_ | |
| Mobile browser | _Yes/No/TBD_ | |
| Native mobile app | _Yes/No/TBD_ | |
| Tablet | _Yes/No/TBD_ | |

### Integration Requirements

| System | Integration Type | Required | Notes |
|--------|------------------|----------|-------|
| World Sailing Sailor ID | _Import/Export/API_ | _Yes/No/TBD_ | |
| Club membership systems | | | |
| Existing scoring software | | | |

### Data/Performance

| Constraint | Requirement | Notes |
|------------|-------------|-------|
| Max competitors per event | | |
| Max races per series | | |
| Response time for scoring | | |
| Data retention | | |

## Regulatory Constraints

### Governing Body Rules

| Rule Set | Compliance Required | Notes |
|----------|---------------------|-------|
| World Sailing RRS | _Yes/No/Partial_ | |
| National authority variations | | |
| Class association rules | | |

### Data Protection

| Requirement | Applies | Notes |
|-------------|---------|-------|
| GDPR compliance | _Yes/No/TBD_ | |
| Minor competitor data | | |
| Data export/deletion rights | | |

## User Experience Constraints

### User Characteristics

| Characteristic | Description |
|----------------|-------------|
| Technical proficiency | _Describe typical users_ |
| Usage frequency | _Daily scorer vs occasional volunteer_ |
| Training available | _Can we assume training? Documentation?_ |

### Environmental Conditions

| Condition | Impact on Design |
|-----------|------------------|
| Outdoor use | _Glare, weather protection_ |
| Time pressure | _Quick data entry during racing_ |
| Interruptions | _Save state frequently_ |

### Accessibility

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Screen reader support | _High/Medium/Low_ | |
| Keyboard navigation | | |
| Color contrast | | |
| Font sizing | | |

## Business Constraints

| Constraint | Description | Impact |
|------------|-------------|--------|
| Budget | | |
| Timeline | | |
| Team size/skills | | |
| Licensing | _Open source? Commercial?_ | |

## Non-Goals

Things explicitly out of scope for this project.

| Non-Goal | Rationale |
|----------|-----------|
| _Example: Live GPS tracking_ | _Complexity, different problem domain_ |
| | |
