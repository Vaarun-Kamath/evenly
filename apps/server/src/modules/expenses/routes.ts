import {
  createExpenseRequestSchema,
  expenseParamsSchema,
  expenseSchema,
  groupParamsSchema,
  listExpensesQuerySchema,
  pageSchema,
  updateExpenseRequestSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  restoreExpense,
  updateExpense,
} from "./service";

/** `/groups/:gid/expenses`. Register inside a scope that has `requireSession`. */
export function registerExpenseRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();
  const params = expenseParamsSchema;

  routes.get(
    "/groups/:gid/expenses",
    {
      schema: {
        params: groupParamsSchema,
        querystring: listExpensesQuerySchema,
        response: { 200: pageSchema(expenseSchema) },
      },
    },
    (request) => listExpenses(orm, actorOf(request), request.params.gid, request.query),
  );

  // 201 the first time, 200 when a retry repeats an expense that already exists.
  routes.post(
    "/groups/:gid/expenses",
    {
      schema: {
        params: groupParamsSchema,
        body: createExpenseRequestSchema,
        response: { 200: expenseSchema, 201: expenseSchema },
      },
    },
    async (request, reply) => {
      const { expense, created } = await createExpense(
        orm,
        actorOf(request),
        request.params.gid,
        request.body,
      );
      return reply.code(created ? 201 : 200).send(expense);
    },
  );

  routes.get(
    "/groups/:gid/expenses/:eid",
    { schema: { params, response: { 200: expenseSchema } } },
    (request) => getExpense(orm, actorOf(request), request.params.gid, request.params.eid),
  );

  routes.patch(
    "/groups/:gid/expenses/:eid",
    { schema: { params, body: updateExpenseRequestSchema, response: { 200: expenseSchema } } },
    (request) =>
      updateExpense(orm, actorOf(request), request.params.gid, request.params.eid, request.body),
  );

  routes.delete(
    "/groups/:gid/expenses/:eid",
    { schema: { params, response: { 204: z.null() } } },
    async (request, reply) => {
      await deleteExpense(orm, actorOf(request), request.params.gid, request.params.eid);
      return reply.code(204).send(null);
    },
  );

  routes.post(
    "/groups/:gid/expenses/:eid/restore",
    { schema: { params, response: { 200: expenseSchema } } },
    (request) => restoreExpense(orm, actorOf(request), request.params.gid, request.params.eid),
  );
}
