import { handleOrdersRequest } from '../../_lib/orderHttp.js';
import { createOrderStore } from '../../_lib/orderStore.js';

export const onRequest = context => handleOrdersRequest(context, { createStore: createOrderStore });
