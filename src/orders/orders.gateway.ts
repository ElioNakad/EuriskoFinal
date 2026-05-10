import { Server } from 'socket.io';

import { UseFilters, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { WsValidationPipe } from '../common/pipes/ws-validation.pipe';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import type { AuthenticatedSocket } from '../auth/types/authenticated-socket.type';
import { CloseMarketSellOrderDto } from './dto/close-market-sell-order.dto';
import { PlaceMarketBuyOrderDto } from './dto/place-market-buy-order.dto';
import { OrdersService } from './orders.service';

@UseFilters(WsExceptionFilter)
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly wsJwtAuthGuard: WsJwtAuthGuard,
    private readonly ordersService: OrdersService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const isAuthenticated =
      await this.wsJwtAuthGuard.authenticateClient(client);

    if (!isAuthenticated) {
      client.disconnect(true);
    }
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('market_buy_order')
  async handleMarketBuyOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody(
      new WsValidationPipe(PlaceMarketBuyOrderDto, 'Invalid buy order payload'),
    )
    dto: PlaceMarketBuyOrderDto,
  ) {
    try {
      const result = await this.ordersService.placeMarketBuyOrder(
        client.user!.userId,
        dto,
      );

      client.emit('order_filled', result);
    } catch (error) {
      client.emit('order_rejected', {
        message: error instanceof Error ? error.message : 'Order rejected',
      });
    }
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('market_sell_order')
  async handleMarketSellOrder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody(
      new WsValidationPipe(
        CloseMarketSellOrderDto,
        'Invalid sell order payload',
      ),
    )
    dto: CloseMarketSellOrderDto,
  ) {
    try {
      const result = await this.ordersService.closeMarketSellOrder(
        client.user!.userId,
        dto,
      );

      client.emit('order_closed', result);
      client.emit('portfolio_value_updated', result.portfolioSummary);
    } catch (error) {
      client.emit('order_rejected', {
        message: error instanceof Error ? error.message : 'Order rejected',
      });
    }
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('portfolio_summary')
  async handlePortfolioSummary(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const summary = await this.ordersService.getPortfolioSummary(
        client.user!.userId,
      );

      client.emit('portfolio_summary', summary);
    } catch (error) {
      client.emit('portfolio_summary_error', {
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load portfolio summary',
      });
    }
  }
}
