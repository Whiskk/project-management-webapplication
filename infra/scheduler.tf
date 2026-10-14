# Hourly schedule for the budget monitor Lambda (backend/monitor).
#
# Enabled automatically on LocalStack. On AWS it is behind
# var.aws_monitor_schedule_enabled (default false) because the workshop's
# participant role is not permitted to use EventBridge or EventBridge
# Scheduler (events:* / scheduler:* are denied). Admins can still run the
# same check on demand (POST /api/monitor/run, "Run budget check" button).

locals {
  monitor_schedule_enabled = data.aws_caller_identity.this.id == "000000000000" || var.aws_monitor_schedule_enabled
  scheduled_functions      = { for name, fn in local.function_names : name => fn if name == "monitor" && local.monitor_schedule_enabled }
}

resource "aws_cloudwatch_event_rule" "budget_monitor" {
  for_each            = local.scheduled_functions
  name                = format("%s-budget-monitor-%s", var.aws_project, local.app_id)
  description         = "Hourly budget check: flags projects that go over budget"
  schedule_expression = "rate(1 hour)"
  tags                = local.app_tags
}

resource "aws_cloudwatch_event_target" "budget_monitor" {
  for_each = local.scheduled_functions
  rule     = aws_cloudwatch_event_rule.budget_monitor[each.key].name
  arn      = module.lambda[each.key].lambda_function_arn
}

resource "aws_lambda_permission" "budget_monitor" {
  for_each      = local.scheduled_functions
  statement_id  = "AllowHourlyBudgetCheck"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda[each.key].lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.budget_monitor[each.key].arn
}
