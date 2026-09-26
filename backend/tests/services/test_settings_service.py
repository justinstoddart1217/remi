"""Settings updates once the move date has passed."""

from datetime import date

import pytest

from remi.core.clock import FixedClock
from remi.core.errors import ValidationFailed
from remi.core.uow import UnitOfWorkFactory
from remi.schemas.settings import SettingsPatch
from remi.services import settings as settings_service
from remi.services.dev_fixtures import SeedIds


def test_after_the_move_other_settings_still_change(
    uow_factory: UnitOfWorkFactory, seeded: SeedIds
) -> None:
    later = FixedClock(date(2027, 2, 1))
    out = settings_service.update_settings(
        uow_factory, later, SettingsPatch.model_validate({"holidayRegion": "ZA"})
    )
    assert out.entity is not None
    assert (out.entity.holiday_region, out.entity.move_date) == ("ZA", date(2027, 1, 4))
    with pytest.raises(ValidationFailed) as caught:
        settings_service.update_settings(
            uow_factory, later, SettingsPatch.model_validate({"moveDate": "2027-01-29"})
        )
    assert caught.value.field == "moveDate"
