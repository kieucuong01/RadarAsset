export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class OrganizationRequiredError extends Error {
  constructor(message = "Create or join a workspace to continue.") {
    super(message);
    this.name = "OrganizationRequiredError";
  }
}

export class TenantForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "TenantForbiddenError";
  }
}
