import { Construct } from 'constructs';
import * as _budgets from 'aws-cdk-lib/aws-budgets';
import * as shared from '@src/shared';

export class BudgetAlarm extends Construct {
  constructor(scope: Construct) {
    super(scope, 'BudgetAlarm');

    new _budgets.CfnBudget(scope, `MonthlyBudgetAlarm`, {
      budget: {
        budgetName: `monthly-budget-${shared.appConfig.env}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: 10,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            thresholdType: 'PERCENTAGE',
            comparisonOperator: 'GREATER_THAN',
            threshold: 72,
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: shared.appConfig.email,
            },
          ],
        },
      ],
    });
  }
}
